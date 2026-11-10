import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { ORIGIN, PASSWORD, session } from './helpers';
import { EXAMPLE_PROMPTS, MCP_PROMPTS } from '../../src/shared/examples';

const REDIRECT = 'https://client.example/callback';

async function pkce() {
  const verifier = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(
    /[+/=]/g,
    '',
  );
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return { verifier, challenge };
}

function cookies(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

async function connect(password = PASSWORD) {
  const reg = await SELF.fetch(`${ORIGIN}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Test Assistant',
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
    }),
  });
  expect(reg.status).toBe(201);
  const client = (await reg.json()) as { client_id: string };
  const { verifier, challenge } = await pkce();
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
    scope: 'packing',
    resource: `${ORIGIN}/mcp`,
  });
  const page = await SELF.fetch(`${ORIGIN}/authorize?${q}`);
  expect(page.status).toBe(200);
  // A form-action CSP would block the browser from following the redirect back to the client.
  expect(page.headers.get('Content-Security-Policy') ?? '').not.toMatch(/form-action/);
  const html = await page.text();
  expect(html).toContain('Let Test Assistant use Duffel?');
  expect(html).toContain('client.example');
  const handle = /name="handle" value="([^"]+)"/.exec(html)![1]!;
  const form = (pw: string) =>
    new URLSearchParams({
      handle,
      decision: 'approve',
      password: pw,
      client_name: 'Test Assistant',
      redirect_host: 'client.example',
    });
  const post = (pw: string) =>
    SELF.fetch(`${ORIGIN}/authorize`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookies(page),
        'CF-Connecting-IP': '198.18.0.9',
      },
      body: form(pw),
    });
  if (password !== PASSWORD) return { res: await post(password) };
  const wrong = await post('nope');
  expect(wrong.status).toBe(401);
  expect(await wrong.text()).toContain('That password is not right.');
  const ok = await post(PASSWORD);
  expect(ok.status).toBe(302);
  const loc = new URL(ok.headers.get('Location')!);
  expect(loc.origin + loc.pathname).toBe(REDIRECT);
  expect(loc.searchParams.get('state')).toBe('xyz');
  const tok = await SELF.fetch(`${ORIGIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: loc.searchParams.get('code')!,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      client_id: client.client_id,
      resource: `${ORIGIN}/mcp`,
    }),
  });
  expect(tok.status).toBe(200);
  return { token: ((await tok.json()) as { access_token: string }).access_token };
}

let rpcId = 0;
async function rpc(token: string, method: string, params: unknown = {}) {
  const res = await SELF.fetch(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-06-18',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  const body = await res.text();
  const json = body.startsWith('{') ? body : (/^data: (.*)$/m.exec(body)?.[1] ?? body);
  return {
    status: res.status,
    data: JSON.parse(json) as {
      result?: { content?: { text: string }[]; tools?: { name: string }[]; isError?: boolean };
      error?: unknown;
    },
  };
}

describe('MCP', () => {
  it('advertises OAuth and rejects requests without a token', async () => {
    const res = await SELF.fetch(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toMatch(/resource_metadata=/);
    const meta = (await (
      await SELF.fetch(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`)
    ).json()) as { resource: string; authorization_servers: string[] };
    expect(meta.resource).toBe(`${ORIGIN}/mcp`);
    expect(meta.authorization_servers).toEqual([ORIGIN]);
  });

  // Long: it walks through most tools in one session.
  it('connects with the household password and runs tools', { timeout: 30_000 }, async () => {
    const api = await session();
    await api.post('/sample-data');
    const { token } = await connect();

    const init = await rpc(token!, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    expect(init.status).toBe(200);
    const instructions = (init.data.result as { instructions?: string }).instructions ?? '';
    expect(instructions).toContain('call get_started');
    expect(instructions).toContain(EXAMPLE_PROMPTS[0]!.prompt);
    const tools = await rpc(token!, 'tools/list');
    expect(tools.data.result!.tools!.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'list_trips',
        'get_packing_list',
        'add_items',
        'update_item',
        'set_packed',
        'create_trip',
        'save_trip_as_template',
        'search_catalog',
        'list_todos',
        'add_todos',
        'update_todo',
        'remove_todo',
        'get_template',
        'update_template_item',
        'set_group_order',
        'get_started',
        'get_itinerary',
        'add_itinerary_section',
        'update_itinerary_section',
        'remove_itinerary_section',
        'add_itinerary_entries',
        'update_itinerary_entry',
        'remove_itinerary_entry',
      ]),
    );

    const trips = await rpc(token!, 'tools/call', { name: 'list_trips', arguments: {} });
    expect(trips.data.result!.content![0]!.text).toContain('Lisbon');

    const add = await rpc(token!, 'tools/call', {
      name: 'add_items',
      arguments: {
        trip: 'lisbon',
        items: [{ name: 'Beach towel', for: 'Mia', bag: 'Kids’ suitcase', qty: 2 }],
      },
    });
    expect(add.data.result!.isError).toBeFalsy();
    const list = JSON.parse(
      (await rpc(token!, 'tools/call', { name: 'get_packing_list', arguments: { trip: 'Lisbon' } }))
        .data.result!.content![0]!.text,
    ) as {
      items: { id: string; name: string; for: string; bag: string; qty: number; packed: boolean }[];
    };
    const towel = list.items.find((i) => i.name === 'Beach towel')!;
    expect(towel).toMatchObject({ for: 'Mia', bag: 'Kids’ suitcase', qty: 2, packed: false });

    const upd = await rpc(token!, 'tools/call', {
      name: 'update_item',
      arguments: { item_id: towel.id, packed: true, bag: 'no bag' },
    });
    expect(upd.data.result!.content![0]!.text).toContain('packed');

    const bad = await rpc(token!, 'tools/call', {
      name: 'add_items',
      arguments: { items: [{ name: 'X', for: 'Nobody named this' }] },
    });
    expect(bad.data.result!.isError).toBe(true);

    const created = await rpc(token!, 'tools/call', {
      name: 'create_trip',
      arguments: {
        name: 'Lisbon again',
        copy_trip: 'Lisbon',
        start_date: '2027-03-01',
        end_date: '2027-03-04',
      },
    });
    const trip = JSON.parse(created.data.result!.content![0]!.text) as {
      created: { items: { packed: boolean }[] };
    };
    expect(trip.created.items.length).toBeGreaterThan(10);
    expect(trip.created.items.every((i) => !i.packed)).toBe(true);

    // To-dos.
    const call = async (name: string, args: object) => {
      const r = (await rpc(token!, 'tools/call', { name, arguments: args })).data.result!;
      return { error: !!r.isError, text: r.content![0]!.text };
    };
    type Todo = { id: string; title: string; when: string; date?: string; done?: boolean };
    const todosOf = async (args: object) =>
      (JSON.parse((await call('list_todos', args)).text) as { todos: Todo[] }).todos;
    expect(await todosOf({ trip: 'Lisbon' })).toHaveLength(6);
    const added = await call('add_todos', {
      trip: 'Lisbon',
      todos: [
        {
          title: 'Print boarding passes',
          relative: { days: 1, direction: 'before', anchor: 'start' },
        },
        { title: 'Pay the deposit', date: '2026-11-20', notes: 'Card ending 42' },
      ],
    });
    expect(added).toEqual({ error: false, text: 'Added 2 to-dos to Lisbon.' });
    const lisbon = await todosOf({ trip: 'Lisbon' });
    const passes = lisbon.find((t) => t.title === 'Print boarding passes')!;
    // Sample trips are dated from today, so check the date is the day before the start.
    const start = (
      JSON.parse((await call('list_todos', { trip: 'Lisbon' })).text) as {
        start_date: string;
      }
    ).start_date;
    const dayBefore = new Date(Date.parse(start) - 86_400_000).toISOString().slice(0, 10);
    expect(passes).toMatchObject({ when: '1 day before the trip starts', date: dayBefore });
    expect(lisbon.find((t) => t.title === 'Pay the deposit')?.date).toBe('2026-11-20');
    const done = await call('update_todo', { todo_id: passes.id, done: true });
    expect(JSON.parse(done.text).updated.done).toBe(true);
    await call('update_todo', { todo_id: passes.id, date: null });
    expect((await todosOf({ trip: 'Lisbon' })).find((t) => t.id === passes.id)?.when).toBe(
      'no date',
    );
    expect((await call('remove_todo', { todo_id: passes.id })).error).toBe(false);
    expect(await todosOf({ trip: 'Lisbon' })).toHaveLength(7);

    await call('add_todos', {
      template: 'Beach week',
      todos: [{ title: 'Sunscreen run', relative: { direction: 'on', anchor: 'middle' } }],
    });
    const tplTodos = await todosOf({ template: 'Beach week' });
    expect(tplTodos.find((t) => t.title === 'Sunscreen run')?.when).toBe('The middle of the trip');
    const tplDone = await call('update_todo', { todo_id: tplTodos[0]!.id, done: true });
    expect(tplDone.error).toBe(true);
    expect((await call('list_todos', { trip: 'Lisbon', template: 'Beach week' })).error).toBe(true);

    // Groups.
    type Pack = {
      group_order: string[];
      items: { id: string; name: string; group: string | null }[];
    };
    const pack = async () =>
      JSON.parse((await call('get_packing_list', { trip: 'Lisbon' })).text) as Pack;
    let lis = await pack();
    expect(lis.group_order.length).toBeGreaterThan(1);
    const towelRow = lis.items.find((i) => i.name === 'Beach towel')!;
    expect((await call('update_item', { item_id: towelRow.id, group: 'Beach stuff' })).error).toBe(
      false,
    );
    await call('add_items', { trip: 'Lisbon', items: [{ name: 'Snorkel', group: 'Beach stuff' }] });
    lis = await pack();
    expect(lis.items.filter((i) => i.group === 'Beach stuff').map((i) => i.name)).toEqual(
      expect.arrayContaining(['Beach towel', 'Snorkel']),
    );
    const ordered = JSON.parse(
      (await call('set_group_order', { trip: 'Lisbon', order: ['Beach stuff'] })).text,
    ) as { group_order: string[] };
    expect(ordered.group_order[0]).toBe('Beach stuff');
    expect((await pack()).group_order[0]).toBe('Beach stuff');

    type Tpl = {
      group_order: string[];
      items: { id: string; name: string; group: string | null; who_packs: string[] | string }[];
    };
    const tplView = JSON.parse(
      (await call('get_template', { template: 'Beach week' })).text,
    ) as Tpl;
    const ti = tplView.items[0]!;
    const updated = JSON.parse(
      (
        await call('update_template_item', {
          template_item_id: ti.id,
          group: 'Essentials',
          who_packs: ['Sam', 'Mia'],
        })
      ).text,
    ) as { updated: Tpl['items'][number] };
    expect(updated.updated).toMatchObject({ group: 'Essentials', who_packs: ['Sam', 'Mia'] });
    await call('set_group_order', { template: 'Beach week', order: ['Essentials'] });
    expect(
      (JSON.parse((await call('get_template', { template: 'Beach week' })).text) as Tpl)
        .group_order[0],
    ).toBe('Essentials');
    expect(
      (await call('update_template_item', { template_item_id: 'nope', group: 'x' })).error,
    ).toBe(true);

    // Itinerary: bookings as an assistant would read them from a confirmation email.
    const flights = {
      trip: 'Lisbon',
      section: 'Getting there',
      section_kind: 'travel',
      entries: [
        {
          kind: 'transport',
          mode: 'plane',
          carrier: 'TAP',
          number: '204',
          start: { code: 'BOS', date: '2027-06-02', time: '21:40' },
          end: { code: 'LIS', date: '2027-06-03', time: '09:05' },
          confirmation: 'QX7P2L',
          details: 'Seats 23A–D',
        },
        {
          kind: 'transport',
          carrier: 'TAP',
          number: '1944',
          start: { code: 'LIS', date: '2027-06-03', time: '10:55' },
          end: { code: 'OPO', date: '2027-06-03', time: '11:50' },
          confirmation: 'QX7P2L',
        },
      ],
    };
    const addFlights = JSON.parse((await call('add_itinerary_entries', flights)).text) as {
      added: string[];
      entries: { name: string; duration?: string; layover_after?: string; depart: object }[];
    };
    expect(addFlights.added).toEqual(['TAP 204', 'TAP 1944']);
    expect(addFlights.entries[0]).toMatchObject({
      name: 'TAP 204',
      duration: '6h 25m',
      layover_after: '1h 50m in Lisbon',
      depart: { code: 'BOS', place: 'Boston', time_zone: 'America/New_York' },
    });
    // Running it again adds nothing.
    const again = JSON.parse((await call('add_itinerary_entries', flights)).text) as {
      added: string[];
      skipped_as_already_there: string[];
    };
    expect(again.added).toEqual([]);
    expect(again.skipped_as_already_there).toHaveLength(2);
    await call('add_itinerary_entries', {
      trip: 'Lisbon',
      section: 'Porto',
      entries: [
        {
          kind: 'lodging',
          title: 'Casa do Rio',
          start: { date: '2027-06-03', time: '15:00', time_zone: 'Europe/Lisbon' },
          end: { date: '2027-06-07', time: '11:00', time_zone: 'Europe/Lisbon' },
          confirmation: 'HB-889',
        },
      ],
    });
    expect(
      (
        await call('add_itinerary_section', {
          trip: 'Lisbon',
          kind: 'travel',
          title: 'Heading home',
        })
      ).error,
    ).toBe(false);
    await call('update_itinerary_section', {
      trip: 'Lisbon',
      section: 'Heading home',
      position: 1,
    });
    type Itin = {
      sections: { title: string; kind: string; entries: { entry_id: string; name: string }[] }[];
    };
    let itin = JSON.parse((await call('get_itinerary', { trip: 'Lisbon' })).text) as Itin;
    expect(itin.sections.map((x) => [x.title, x.kind])).toEqual([
      ['Heading home', 'travel'],
      ['Getting there', 'travel'],
      ['Porto', 'stay'],
    ]);
    await call('update_itinerary_section', {
      trip: 'Lisbon',
      section: 'Heading home',
      position: 3,
    });
    const hotel = itin.sections[2]!.entries[0]!;
    const moved = await call('update_itinerary_entry', {
      entry_id: hotel.entry_id,
      end: { time: '12:00' },
      notes: 'Late checkout',
    });
    expect(JSON.parse(moved.text).updated).toMatchObject({
      end: { date: '2027-06-07', time: '12:00' },
      notes: 'Late checkout',
    });
    expect(
      (
        await call('update_itinerary_entry', {
          entry_id: hotel.entry_id,
          end: { date: '2027-06-01' },
        })
      ).error,
    ).toBe(true);
    expect((await call('remove_itinerary_entry', { entry_id: hotel.entry_id })).error).toBe(false);
    expect(
      (await call('remove_itinerary_section', { trip: 'Lisbon', section: 'Heading home' })).error,
    ).toBe(false);
    itin = JSON.parse((await call('get_itinerary', { trip: 'Lisbon' })).text) as Itin;
    expect(itin.sections.map((x) => x.title)).toEqual(['Getting there', 'Porto']);
    const bookings = await rpc(token!, 'prompts/get', {
      name: 'add_bookings',
      arguments: { trip: 'Lisbon' },
    });
    expect(JSON.stringify(bookings.data.result)).toContain('connected email');

    // Orientation: ready-made prompts and get_started.
    const prompts = (await rpc(token!, 'prompts/list')).data.result as unknown as {
      prompts: { name: string; arguments?: { name: string; description?: string }[] }[];
    };
    expect(prompts.prompts.map((p) => p.name).sort()).toEqual(
      MCP_PROMPTS.map((p) => p.name).sort(),
    );
    expect(prompts.prompts.every((p) => (p.arguments ?? []).every((a) => !!a.description))).toBe(
      true,
    );
    const got = await rpc(token!, 'prompts/get', {
      name: 'plan_trip',
      arguments: { where: 'Kyoto', dates: 'April 2 to 9' },
    });
    expect(JSON.stringify(got.data.result)).toContain('Kyoto, April 2 to 9');
    const left = await rpc(token!, 'prompts/get', { name: 'whats_left', arguments: {} });
    expect(JSON.stringify(left.data.result)).toContain('our next trip');
    const started = await call('get_started', {});
    expect(started.error).toBe(false);
    expect(started.text).toContain('Household: Sam');
    expect(started.text).toContain('Next trip: Lisbon');
    for (const e of EXAMPLE_PROMPTS) expect(started.text).toContain(e.prompt);
    for (const p of MCP_PROMPTS) expect(started.text).toContain(p.name);

    // The app lists the connection and can revoke it.
    const conns = (await api.get<{ connections: { name: string }[] }>('/connections')).data;
    expect(conns.connections.map((c) => c.name)).toContain('Test Assistant');
    expect((await api.post('/connections/revoke-all')).status).toBe(200);
    expect((await rpc(token!, 'tools/list')).status).toBe(401);
  });

  it('does not issue a token for a wrong password', async () => {
    const { res } = await connect('wrong');
    expect(res!.status).toBe(401);
  });
});

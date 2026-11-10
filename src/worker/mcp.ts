// MCP server: lets any MCP-capable assistant read and update this household's packing lists.
// Tools call the same REST API the app uses (validation and logic live there), marked internal
// because OAuthProvider has already checked the assistant's token.
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  calcSummary,
  connections,
  entryMinutes,
  entryName,
  formatMinutes,
  orderEntries,
  sortSections,
  describeRelative,
  displayQty,
  isCarryOn,
  localToday,
  orderCategories,
  packChoice,
  packLabel,
  resolveCalc,
  shortBagLabel,
  sortTemplateTodos,
  sortTripTodos,
  splitTrips,
  todoDueDate,
} from '@shared/logic';
import {
  DEFAULT_LOOKUPS,
  ENTRY_KINDS,
  SECTION_KINDS,
  TRANSPORT_MODES,
  REL_ANCHORS,
  REL_DIRS,
  TODO_PHASE_LABELS,
  TODO_PHASES,
} from '@shared/lookups';
import type {
  AppState,
  EntryEnd,
  ItinerarySection,
  Item,
  Person,
  Template,
  TemplateTodo,
  TodoWhen,
  TripBag,
  TripDetail,
  TripItem,
} from '@shared/types';
import { EXAMPLE_PROMPTS, MCP_PROMPTS } from '@shared/examples';
import { app } from './app';
import { INTERNAL } from './auth';

type Call = <T>(method: string, path: string, body?: unknown) => Promise<T>;

class ToolError extends Error {}

function apiCaller(origin: string, env: Cloudflare.Env, ctx: ExecutionContext): Call {
  const internalEnv = { ...env, [INTERNAL]: true };
  return async <T>(method: string, path: string, body?: unknown) => {
    const res = await app.fetch(
      new Request(`${origin}/api${path}`, {
        method,
        headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      }),
      internalEnv,
      ctx,
    );
    const data = (await res.json().catch(() => null)) as T & { message?: string };
    if (!res.ok) throw new ToolError(data?.message ?? `Request failed (${res.status}).`);
    return data;
  };
}

const text = (v: unknown) => ({
  content: [
    { type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) },
  ],
});
const fail = (e: unknown) => ({
  content: [
    { type: 'text' as const, text: e instanceof Error ? e.message : 'Something went wrong.' },
  ],
  isError: true,
});

function find<T extends { id: string }>(
  list: T[],
  key: string,
  nameOf: (t: T) => string,
  what: string,
): T {
  const k = key.trim().toLowerCase();
  const hit = list.find((t) => t.id === key) ?? list.find((t) => nameOf(t).toLowerCase() === k);
  if (hit) return hit;
  const partial = list.filter((t) => nameOf(t).toLowerCase().includes(k));
  if (partial.length === 1) return partial[0]!;
  const options = list.map(nameOf).join(', ') || 'none';
  throw new ToolError(`No ${what} matches “${key}”. Options: ${options}.`);
}

/** How an assistant sees a to-do: when it's due in words and as a date. */
function todoView(t: TemplateTodo | TripDetail['todos'][number], trip?: TripDetail['trip']) {
  const date = trip ? todoDueDate(t, trip) : t.date_mode === 'fixed' ? t.due_date : null;
  return {
    id: t.id,
    title: t.title,
    phase: TODO_PHASE_LABELS[t.phase],
    when:
      t.date_mode === 'relative'
        ? describeRelative(t)
        : t.date_mode === 'fixed'
          ? 'fixed date'
          : 'no date',
    ...(date ? { date } : {}),
    ...('done' in t ? { done: t.done } : {}),
    ...(t.notes ? { notes: t.notes } : {}),
  };
}

const todoDateInput = {
  date: z
    .string()
    .nullable()
    .optional()
    .describe('A fixed date, YYYY-MM-DD. null removes the date.'),
  relative: z
    .object({
      days: z.number().int().min(0).max(3650).default(0),
      direction: z.enum(REL_DIRS),
      anchor: z.enum(REL_ANCHORS).describe('Start, middle or end of the trip'),
    })
    .optional()
    .describe(
      'A date relative to the trip, e.g. 3 days before the start. Follows the trip’s dates.',
    ),
};

function whenFrom(a: {
  date?: string | null;
  relative?: { days: number; direction: TodoWhen['rel_dir']; anchor: TodoWhen['rel_anchor'] };
}): Partial<TodoWhen> {
  if (a.relative)
    return {
      date_mode: 'relative',
      rel_days: a.relative.days,
      rel_dir: a.relative.direction,
      rel_anchor: a.relative.anchor,
    };
  if (a.date === null) return { date_mode: 'none' };
  if (a.date !== undefined) return { date_mode: 'fixed', due_date: a.date };
  return {};
}

/** The groups on a list, in the order they're shown. */
function groupOrder(rows: { category: string | null }[], saved: string[]) {
  const present = rows.map((r) => r.category?.trim()).filter((c): c is string => !!c);
  return orderCategories(present, saved, DEFAULT_LOOKUPS.category);
}

const groupInput = z
  .string()
  .nullable()
  .optional()
  .describe('Item group, e.g. "Clothing" or "Documents". null takes it out of its group.');

function summarizeTrip(d: TripDetail, people: Person[]) {
  const bags = new Map(d.bags.map((b) => [b.id, b]));
  const names = new Map(people.map((p) => [p.id, p.name]));
  return {
    id: d.trip.id,
    name: d.trip.name,
    start_date: d.trip.start_date,
    end_date: d.trip.end_date,
    days: d.trip.days,
    nights: d.trip.nights,
    destination: d.trip.destination,
    travelers: d.trip.travelers.map((p) => names.get(p) ?? p),
    packed: `${d.items.filter((r) => r.packed).length} of ${d.items.length}`,
    group_order: groupOrder(d.items, d.trip.category_order),
    bags: d.bags.map((b) => ({
      id: b.id,
      name: shortBagLabel(b.label, d.trip.name),
      carry_on: b.carry_on,
    })),
    items: d.items.map((r) => ({
      id: r.id,
      name: r.name,
      group: r.category,
      for: r.person_id ? (names.get(r.person_id) ?? 'Shared') : 'Shared',
      bag: r.trip_bag_id
        ? shortBagLabel(bags.get(r.trip_bag_id)?.label ?? '', d.trip.name)
        : 'No bag',
      carry_on: isCarryOn(r, bags),
      qty: displayQty(r),
      packed: r.packed,
      notes: r.notes,
    })),
    todos: sortTripTodos(d.todos, d.trip).map((t) => todoView(t, d.trip)),
    itinerary: `${d.itinerary.length} section${d.itinerary.length === 1 ? '' : 's'}, ${d.itinerary.reduce((n, x) => n + x.entries.length, 0)} entries (see get_itinerary)`,
  };
}

const endView = (e: EntryEnd) =>
  Object.fromEntries(
    Object.entries({
      place: e.place,
      code: e.code,
      date: e.date,
      time: e.time,
      time_zone: e.tz,
    }).filter(([, v]) => v !== null),
  );

/** How an assistant sees the itinerary: sections and entries in order, with layovers. */
function itineraryView(sections: ItinerarySection[]) {
  return sortSections(sections).map((s) => {
    const entries = orderEntries(s.entries);
    const layovers = new Map(connections(entries).map((c) => [c.after, c]));
    return {
      section_id: s.id,
      kind: s.kind,
      title: s.title,
      ...(s.notes ? { notes: s.notes } : {}),
      entries: entries.map((e) => {
        const min = entryMinutes(e);
        const lay = layovers.get(e.id);
        return Object.fromEntries(
          Object.entries({
            entry_id: e.id,
            kind: e.kind,
            name: entryName(e),
            mode: e.mode,
            title: e.title,
            carrier: e.carrier,
            number: e.number,
            [e.kind === 'transport' ? 'depart' : 'start']: endView(e.start),
            [e.kind === 'transport' ? 'arrive' : 'end']: endView(e.end),
            duration: min !== null ? formatMinutes(min) : null,
            layover_after: lay
              ? `${formatMinutes(lay.minutes)}${lay.at ? ` in ${lay.at}` : ''}${lay.change ? `, change ${lay.change.from} → ${lay.change.to}` : ''}`
              : null,
            address: e.address,
            confirmation: e.confirmation,
            details: e.details,
            notes: e.notes,
          }).filter(([, v]) => v !== null && !(typeof v === 'object' && !Object.keys(v).length)),
        );
      }),
    };
  });
}

const endInput = z
  .object({
    place: z.string().optional().describe('City, station, venue or address name'),
    code: z
      .string()
      .optional()
      .describe('IATA airport code like "BOS". Fills in the city and time zone when known.'),
    date: z.string().optional().describe('Local date, YYYY-MM-DD'),
    time: z.string().optional().describe('Local 24-hour time, HH:MM, as printed on the booking'),
    time_zone: z
      .string()
      .optional()
      .describe(
        'IANA zone of that place, e.g. "America/Cancun" for a Cancún hotel. Give it for hotels, plans and anything without an airport code; if left out, the trip\'s nearest zone is used.',
      ),
  })
  .optional();
type EndArg = z.infer<typeof endInput>;
const endBody = (e: EndArg) =>
  e && {
    ...(e.place !== undefined ? { place: e.place } : {}),
    ...(e.code !== undefined ? { code: e.code } : {}),
    ...(e.date !== undefined ? { date: e.date } : {}),
    ...(e.time !== undefined ? { time: e.time } : {}),
    ...(e.time_zone !== undefined ? { tz: e.time_zone } : {}),
  };

const entryFields = {
  mode: z
    .enum(TRANSPORT_MODES)
    .optional()
    .describe('Transport only: plane, train, bus, boat, car or other'),
  title: z
    .string()
    .optional()
    .describe(
      'Hotel or plan name, e.g. "Casa do Rio" or "Dinner at Taberna". Optional for transport.',
    ),
  carrier: z.string().optional().describe('Airline, rail or bus company, rental company'),
  number: z.string().optional().describe('Flight or train number, e.g. "204"'),
  start: endInput.describe(
    'Transport: the departure. Lodging: check-in. Plan: when it starts (and where, in place).',
  ),
  end: endInput.describe('Transport: the arrival. Lodging: check-out. Plan: when it ends.'),
  address: z.string().optional(),
  confirmation: z.string().optional().describe('Confirmation, booking or record locator'),
  details: z.string().optional().describe('Seats, terminal, gate, room, short'),
  notes: z.string().optional(),
};

const INSTRUCTIONS = `Duffel is a household's packing list. Each trip has a packing list (one entry per person per item, placed in bags and sorted into groups like Clothing or Documents) and to-dos before, during and after the trip. Trips also have an itinerary: sections in order (travel, like "Getting there", and stays, like "Lisbon"), each holding transport (a departure and its arrival), lodging, plans and notes. Templates are reusable lists; the catalog is everything the household packs.

How to work with it:
- Refer to trips, templates, people and bags by name. Item and to-do ids come from get_packing_list, get_template and list_todos.
- Build trips with create_trip from a template or by copying a past trip: quantities scale with the trip's length, each person gets their own entries, and items go into their bags.
- Give to-dos relative dates (days before, on or after the start, middle or end of the trip) so they move with the trip.
- Itinerary times are local, as printed on the booking, with each place's IANA time zone (an airport code fills it in). Add one transport entry per flight segment so layovers show. If the person's email is connected to you too, you can search it for confirmations and add them (see the add_bookings prompt).
- Ask before removing items or changing many entries at once.

When someone asks what you can do with Duffel (or seems unsure where to start), call get_started: it returns their trips and lists as they stand now, and example requests to offer. Suggest two or three that fit, phrased for their trips, rather than listing tools. Examples:
${EXAMPLE_PROMPTS.map((e) => `- "${e.prompt}"`).join('\n')}`;

function buildServer(call: Call) {
  const server = new McpServer(
    { name: 'duffel', version: '1.0.0' },
    { instructions: INSTRUCTIONS },
  );
  const state = () => call<AppState>('GET', '/state');
  const trip = (id: string) => call<TripDetail>('GET', `/trips/${encodeURIComponent(id)}`);
  async function resolveTrip(key?: string) {
    const s = await state();
    if (!key) {
      const { active, archived } = splitTrips(s.trips, localToday());
      const t = active[0] ?? archived[0];
      if (!t) throw new ToolError('There are no trips yet. Use create_trip first.');
      return { s, t };
    }
    return { s, t: find(s.trips, key, (t) => t.name, 'trip') };
  }
  function resolvePerson(
    people: Person[],
    key: string | null | undefined,
  ): string | null | undefined {
    if (key === undefined) return undefined;
    if (key === null || /^(shared|nobody|none)$/i.test(key.trim())) return null;
    return find(people, key, (p) => p.name, 'person').id;
  }
  function resolveBag(bags: TripBag[], tripName: string, key: string | undefined) {
    if (key === undefined) return {};
    if (/^no bag$|^none$|^outside$/i.test(key.trim())) return { no_bag: true, trip_bag_id: null };
    if (/^(later|undecided|no bag yet)$/i.test(key.trim()))
      return { no_bag: false, trip_bag_id: null };
    return {
      trip_bag_id: find(bags, key, (b) => shortBagLabel(b.label, tripName), 'bag').id,
      no_bag: false,
    };
  }

  server.registerTool(
    'list_trips',
    {
      description:
        'List upcoming and past trips with packing progress, plus the household’s people.',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const s = await state();
        const { active, archived } = splitTrips(s.trips, localToday());
        const row = (t: (typeof s.trips)[number]) => ({
          id: t.id,
          name: t.name,
          start_date: t.start_date,
          end_date: t.end_date,
          destination: t.destination,
          packed: `${t.packed_count} of ${t.item_count}`,
        });
        return text({
          household: s.settings.instance_name,
          people: s.people.map((p) => p.name),
          upcoming: active.map(row),
          past: archived.map(row),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'get_packing_list',
    {
      description:
        'Show a trip’s packing list: every item with its group, who it’s for, which bag, carry-on, quantity and packed state, plus the group order and the trip’s to-dos. Defaults to the next upcoming trip.',
      inputSchema: z.object({ trip: z.string().optional().describe('Trip name or id') }),
    },
    async ({ trip: key }) => {
      try {
        const { s, t } = await resolveTrip(key);
        return text(summarizeTrip(await trip(t.id), s.people));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'search_catalog',
    {
      description:
        'Search the catalog of things this household packs, with each item’s group, quantity rule, who packs it, and the weather and activities it’s for.',
      inputSchema: z.object({ query: z.string().optional() }),
    },
    async ({ query }) => {
      try {
        const s = await state();
        const q = query?.trim().toLowerCase() ?? '';
        const names = new Map(s.people.map((p) => [p.id, p.name]));
        const hits = s.items.filter(
          (i: Item) =>
            !i.archived &&
            (!q ||
              i.name.toLowerCase().includes(q) ||
              (i.category ?? '').toLowerCase().includes(q)),
        );
        return text(
          hits.map((i) => ({
            id: i.id,
            name: i.name,
            category: i.category,
            quantity:
              i.qty_mode === 'fixed'
                ? i.qty
                : `${i.qty} ${i.qty_mode.replace('_', ' ')}${i.qty_offset ? ` ${i.qty_offset > 0 ? 'plus' : 'minus'} ${Math.abs(i.qty_offset)}` : ''}${i.max_qty !== null ? `, max ${i.max_qty}` : ''}`,
            who_packs: i.default_people.map((p) => names.get(p) ?? p),
            weather: i.climate_tags,
            activities: i.activity_tags,
            auto_pack: packLabel(packChoice(i)),
          })),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'add_items',
    {
      description:
        'Add items to a trip’s packing list. Names that match the catalog use its quantity rules and group. bag can be a bag name, "no bag" (travels outside any bag) or "later".',
      inputSchema: z.object({
        trip: z.string().optional().describe('Trip name or id; defaults to the next trip'),
        items: z
          .array(
            z.object({
              name: z.string().min(1),
              for: z.string().optional().describe('Person name, or "shared"'),
              bag: z.string().optional(),
              qty: z.number().nonnegative().optional(),
              group: groupInput,
              notes: z.string().optional(),
            }),
          )
          .min(1)
          .max(100),
      }),
    },
    async ({ trip: key, items }) => {
      try {
        const { s, t } = await resolveTrip(key);
        const d = await trip(t.id);
        const added: string[] = [];
        for (const it of items) {
          const match = s.items.find(
            (i) => !i.archived && i.name.toLowerCase() === it.name.trim().toLowerCase(),
          );
          const row = await call<TripItem>('POST', `/trips/${t.id}/items`, {
            name: match?.name ?? it.name.trim(),
            item_id: match?.id ?? null,
            person_id: resolvePerson(s.people, it.for ?? null) ?? null,
            ...resolveBag(d.bags, t.name, it.bag),
            ...(match ? { qty_override: it.qty ?? null } : { qty: it.qty ?? 1 }),
            ...(it.group !== undefined ? { category: it.group } : {}),
            notes: it.notes ?? null,
          });
          added.push(`${row.name} (×${displayQty(row) ?? '?'})`);
        }
        return text(`Added to ${t.name}: ${added.join(', ')}.`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'update_item',
    {
      description:
        'Change one item on a packing list: mark packed or unpacked, move it to another person, bag or group, change quantity, rename, or edit notes. Use ids from get_packing_list.',
      inputSchema: z.object({
        item_id: z.string(),
        packed: z.boolean().optional(),
        for: z.string().optional().describe('Person name, or "shared"'),
        bag: z.string().optional().describe('Bag name, "no bag" or "later"'),
        qty: z.number().nonnegative().optional(),
        name: z.string().optional(),
        group: groupInput,
        notes: z.string().optional(),
      }),
    },
    async ({ item_id, packed, for: who, bag, qty, name, group, notes }) => {
      try {
        const s = await state();
        const owner = s.trips.length ? await findRowTrip(s, item_id) : null;
        if (!owner)
          throw new ToolError(
            'No packing-list item has that id. Use get_packing_list to find ids.',
          );
        const row = await call<TripItem>('PATCH', `/trip-items/${item_id}`, {
          ...(packed !== undefined ? { packed } : {}),
          ...(who !== undefined ? { person_id: resolvePerson(s.people, who) } : {}),
          ...resolveBag(owner.bags, owner.trip.name, bag),
          ...(qty !== undefined ? (owner.row.calc_mode ? { qty_override: qty } : { qty }) : {}),
          ...(name !== undefined ? { name } : {}),
          ...(group !== undefined ? { category: group } : {}),
          ...(notes !== undefined ? { notes } : {}),
        });
        return text(`Updated ${row.name}${row.packed ? ' (packed)' : ''}.`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  async function findRowTrip(s: AppState, rowId: string) {
    for (const t of s.trips) {
      const d = await trip(t.id);
      const row = d.items.find((r) => r.id === rowId);
      if (row) return { trip: d.trip, bags: d.bags, row };
    }
    return null;
  }

  server.registerTool(
    'set_packed',
    {
      description: 'Mark several items on one trip as packed (or not packed) at once.',
      inputSchema: z.object({
        trip: z.string().optional(),
        item_ids: z.array(z.string()).min(1).max(200),
        packed: z.boolean().default(true),
      }),
    },
    async ({ trip: key, item_ids, packed }) => {
      try {
        const { t } = await resolveTrip(key);
        const d = await trip(t.id);
        const ids = new Set(d.items.map((r) => r.id));
        const missing = item_ids.filter((id) => !ids.has(id));
        if (missing.length)
          throw new ToolError(`These ids aren’t on ${t.name}: ${missing.join(', ')}.`);
        for (const id of item_ids) await call('PATCH', `/trip-items/${id}`, { packed });
        return text(
          `Marked ${item_ids.length} item${item_ids.length === 1 ? '' : 's'} as ${packed ? 'packed' : 'not packed'} on ${t.name}.`,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'remove_item',
    {
      description: 'Remove one item from a packing list.',
      inputSchema: z.object({ item_id: z.string() }),
    },
    async ({ item_id }) => {
      try {
        await call('DELETE', `/trip-items/${item_id}`);
        return text('Removed.');
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'create_trip',
    {
      description:
        'Create a trip from a template, by copying a past trip (everything starts unpacked and to-dos undone), or blank. Dates are YYYY-MM-DD; per-day items scale to the trip length and relative to-do dates follow the trip.',
      inputSchema: z.object({
        name: z.string().min(1),
        from_template: z.string().optional().describe('Template name or id'),
        copy_trip: z.string().optional().describe('Past trip name or id to copy'),
        start_date: z.string().optional(),
        end_date: z.string().optional(),
        destination: z.string().optional(),
        travelers: z.array(z.string()).optional().describe('People’s names; defaults to everyone'),
      }),
    },
    async (a) => {
      try {
        const s = await state();
        if (a.from_template && a.copy_trip)
          throw new ToolError('Use either from_template or copy_trip, not both.');
        const source = a.from_template
          ? {
              kind: 'template',
              template_id: find<Template>(s.templates, a.from_template, (t) => t.name, 'template')
                .id,
            }
          : a.copy_trip
            ? { kind: 'clone', trip_id: find(s.trips, a.copy_trip, (t) => t.name, 'trip').id }
            : { kind: 'blank' };
        const travelers =
          a.travelers?.map((n) => find(s.people, n, (p) => p.name, 'person').id) ??
          (a.copy_trip ? [] : s.people.map((p) => p.id));
        const d = await call<TripDetail>('POST', '/trips', {
          name: a.name,
          start_date: a.start_date ?? null,
          end_date: a.end_date ?? null,
          destination: a.destination ?? null,
          travelers,
          source,
        });
        return text({ created: summarizeTrip(d, s.people) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'list_templates',
    {
      description:
        'List templates (reusable packing lists) and what’s on them. Use get_template for item ids and groups.',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const s = await state();
        const items = new Map(s.items.map((i) => [i.id, i.name]));
        return text(
          s.templates.map((t) => ({
            id: t.id,
            name: t.name,
            trip_type: t.trip_type,
            climate: t.climate,
            items: t.items.map((ti) => items.get(ti.item_id) ?? '?'),
            todos: sortTemplateTodos(t.todos).map((x) => todoView(x)),
          })),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'save_trip_as_template',
    {
      description: 'Save a trip’s list as a new template. Packed checkmarks are not saved.',
      inputSchema: z.object({ trip: z.string(), name: z.string().min(1) }),
    },
    async ({ trip: key, name }) => {
      try {
        const { t } = await resolveTrip(key);
        const tpl = await call<Template>('POST', `/trips/${t.id}/save-as-template`, { name });
        return text(`Saved template “${tpl.name}” with ${tpl.items.length} items.`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ---------- templates and groups ----------
  function summarizeTemplate(t: Template, s: AppState) {
    const items = new Map(s.items.map((i) => [i.id, i]));
    const names = new Map(s.people.map((p) => [p.id, p.name]));
    return {
      id: t.id,
      name: t.name,
      trip_type: t.trip_type,
      climate: t.climate,
      activities: t.activities,
      group_order: groupOrder(t.items, t.category_order),
      items: [...t.items]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((ti) => {
          const item = items.get(ti.item_id);
          const who = ti.assignees.length ? ti.assignees : (item?.default_people ?? []);
          return {
            id: ti.id,
            name: item?.name ?? 'Removed item',
            group: ti.category,
            who_packs: who.length ? who.map((p) => names.get(p) ?? p) : 'Shared',
            quantity: calcSummary(
              resolveCalc(item ?? { qty_mode: 'fixed', qty: 1, max_qty: null }, ti),
            ),
            ...(ti.pack_type || ti.carry_on ? { auto_pack: ti.pack_type ?? 'Carry-on' } : {}),
            ...(ti.notes ? { notes: ti.notes } : {}),
          };
        }),
      todos: sortTemplateTodos(t.todos).map((x) => todoView(x)),
    };
  }

  server.registerTool(
    'get_template',
    {
      description:
        'Show a template: its items with ids, groups, who packs each, quantities and notes, the group order, and its to-dos.',
      inputSchema: z.object({ template: z.string().describe('Template name or id') }),
    },
    async ({ template }) => {
      try {
        const s = await state();
        return text(
          summarizeTemplate(
            find(s.templates, template, (t) => t.name, 'template'),
            s,
          ),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'update_template_item',
    {
      description:
        'Change one item on a template: its group, who packs it, or notes. Use ids from get_template.',
      inputSchema: z.object({
        template_item_id: z.string(),
        group: groupInput,
        who_packs: z
          .array(z.string())
          .optional()
          .describe('People’s names. Empty uses the catalog item’s people, or one shared entry.'),
        notes: z.string().nullable().optional(),
      }),
    },
    async ({ template_item_id, group, who_packs, notes }) => {
      try {
        const s = await state();
        const tpl = s.templates.find((t) => t.items.some((i) => i.id === template_item_id));
        if (!tpl)
          throw new ToolError('No template item has that id. Use get_template to find ids.');
        const t = await call<Template>('PATCH', `/template-items/${template_item_id}`, {
          ...(group !== undefined ? { category: group } : {}),
          ...(who_packs !== undefined
            ? { assignees: who_packs.map((n) => find(s.people, n, (p) => p.name, 'person').id) }
            : {}),
          ...(notes !== undefined ? { notes } : {}),
        });
        const row = summarizeTemplate(t, s).items.find((i) => i.id === template_item_id);
        return text({ updated: row });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'set_group_order',
    {
      description:
        'Set the order item groups are shown in on a trip or template. Groups you leave out follow, in their usual order.',
      inputSchema: z.object({
        trip: z.string().optional().describe('Trip name or id; defaults to the next trip'),
        template: z.string().optional().describe('Template name or id'),
        order: z.array(z.string().min(1)).min(1).max(200),
      }),
    },
    async (a) => {
      try {
        const s = await state();
        if (a.trip && a.template) throw new ToolError('Give either trip or template, not both.');
        if (a.template) {
          const t = find(s.templates, a.template, (x) => x.name, 'template');
          const u = await call<Template>('PATCH', `/templates/${t.id}`, {
            category_order: a.order,
          });
          return text({ template: u.name, group_order: groupOrder(u.items, u.category_order) });
        }
        const { t } = await resolveTrip(a.trip);
        const d = await call<TripDetail>('PATCH', `/trips/${t.id}`, { category_order: a.order });
        return text({ trip: d.trip.name, group_order: groupOrder(d.items, d.trip.category_order) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ---------- orientation ----------
  server.registerTool(
    'get_started',
    {
      title: 'What can I do here?',
      description:
        'Call when someone asks what you can do with Duffel or how to start. Returns their household, trips and lists as they stand, example requests that fit, and the ready-made prompts.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const s = await state();
        const today = localToday();
        const { active } = splitTrips(s.trips, today);
        const lines = [
          `Household: ${s.people.map((p) => p.name).join(', ') || 'no people yet'}.`,
          `${s.items.filter((i) => !i.archived).length} items in the catalog, ${s.templates.length} template${s.templates.length === 1 ? '' : 's'}${s.templates.length ? ` (${s.templates.map((t) => t.name).join(', ')})` : ''}.`,
        ];
        const next = active[0];
        if (next) {
          const d = await trip(next.id);
          const open = d.todos.filter((t) => !t.done);
          const late = open.filter((t) => {
            const due = todoDueDate(t, d.trip);
            return !!due && due < today;
          });
          lines.push(
            `Next trip: ${d.trip.name}${d.trip.start_date ? `, ${d.trip.start_date} to ${d.trip.end_date ?? d.trip.start_date}` : ''}. ${d.items.filter((r) => r.packed).length} of ${d.items.length} packed, ${open.length} to-do${open.length === 1 ? '' : 's'} open${late.length ? ` (${late.length} overdue)` : ''}.`,
          );
          if (active.length > 1)
            lines.push(
              `Also coming up: ${active
                .slice(1, 5)
                .map((t) => t.name)
                .join(', ')}.`,
            );
        } else {
          lines.push(
            s.trips.length
              ? 'No upcoming trips. Copying a past trip or starting from a template is a good first step.'
              : 'No trips yet. Creating one from a template (or from scratch) is a good first step.',
          );
        }
        const examples = EXAMPLE_PROMPTS.map((e) => `- "${e.prompt}" — ${e.why}`).join('\n');
        const prompts = MCP_PROMPTS.map((p) => `- ${p.title} (${p.name}): ${p.does}`).join('\n');
        return text(
          `${lines.join('\n')}\n\nThings to offer (fill in <…> from the above, and suggest the two or three that fit best):\n${examples}\n\nReady-made prompts the person can pick in their app's prompt menu:\n${prompts}`,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ---------- prompts ----------
  const ask = (t: string) => ({
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text: t } }],
  });
  const tripArg = z
    .string()
    .optional()
    .describe('Trip name. Leave empty for the next upcoming trip.');

  server.registerPrompt(
    'plan_trip',
    {
      title: 'Plan a trip',
      description:
        'Build a trip’s packing list from a template or a past trip, then suggest extras and to-dos.',
      argsSchema: z.object({
        where: z.string().describe('Where you’re going, e.g. "Lisbon".'),
        dates: z.string().describe('When, e.g. "June 3 to 10".'),
        start_from: z
          .string()
          .optional()
          .describe('A template or past trip to start from. Leave empty to choose together.'),
      }),
    },
    ({ where, dates, start_from }) =>
      ask(`Plan our Duffel trip to ${where}, ${dates}.

1. ${start_from ? `Start from "${start_from}": find it with list_templates or list_trips.` : 'Use list_templates and list_trips to find the best template or past trip to start from, and tell me which you picked.'} Ask who's going if it isn't clear.
2. create_trip with the name, dates (YYYY-MM-DD), destination and travelers, from that template or as a copy of that trip.
3. get_packing_list and search_catalog: suggest catalog items the weather or activities call for that aren't on the list yet. Add only the ones I say yes to (add_items).
4. Suggest a few to-dos with relative dates (for example 14 days before the start). Add the ones I want with add_todos.
5. Finish with a short summary: entries per person, anything in No bag, and the to-dos.`),
  );

  server.registerPrompt(
    'whats_left',
    {
      title: 'What’s left to pack',
      description: 'What isn’t packed yet, by person and bag, plus open and overdue to-dos.',
      argsSchema: z.object({ trip: tripArg }),
    },
    ({ trip: t }) =>
      ask(`What's left to do for ${t ? `"${t}"` : 'our next trip'} in Duffel?

1. get_packing_list${t ? ` for "${t}"` : ''}.
2. List what isn't packed, grouped by person, then by bag, with quantities. Point out anything in No bag.
3. list_todos: show open to-dos, overdue ones first.
4. End with how close we are (packed out of total) and the three things to do next. Don't change anything unless I ask.`),
  );

  server.registerPrompt(
    'add_trip_todos',
    {
      title: 'Add the usual to-dos',
      description:
        'Propose to-dos for before, during and after a trip, with dates that move with it.',
      argsSchema: z.object({
        trip: tripArg,
        notes: z
          .string()
          .optional()
          .describe('Anything special, e.g. "flying, with a dog" or "renting a car".'),
      }),
    },
    ({ trip: t, notes }) =>
      ask(`Suggest to-dos for ${t ? `"${t}"` : 'our next trip'} in Duffel${notes ? ` (${notes})` : ''}.

1. get_packing_list and list_todos${t ? ` for "${t}"` : ''} to see the trip's dates, destination, who's going and the to-dos already there.
2. Propose a short list for Pre-trip, During trip and After trip. Give each a relative date (days before, on or after the start, middle or end of the trip) where timing matters. Skip anything already there.
3. Wait for me to pick, then add the ones I choose with add_todos and show the final list with dates.`),
  );

  server.registerPrompt(
    'organize_groups',
    {
      title: 'Organize into groups',
      description:
        'Propose groups (Clothing, Toiletries, Documents…) and their order for a trip or template, then apply them.',
      argsSchema: z.object({
        trip: z.string().optional().describe('Trip name. Leave empty if organizing a template.'),
        template: z.string().optional().describe('Template name, to organize a template instead.'),
      }),
    },
    ({ trip: t, template }) => {
      const target = template ? `the template "${template}"` : t ? `"${t}"` : 'our next trip';
      const read = template
        ? `get_template "${template}"`
        : `get_packing_list${t ? ` "${t}"` : ''}`;
      const write = template ? 'update_template_item' : 'update_item';
      return ask(`Organize ${target} in Duffel into groups.

1. ${read} to see each item and its current group.
2. Propose a short set of groups (reuse existing ones like Clothing, Toiletries, Documents, Electronics) and which items go in each, plus the order to show them in, the way we'd pack.
3. Don't change anything until I agree. Then set each item's group with ${write} and the order with set_group_order.
4. Show the result as group → items.`);
    },
  );

  // ---------- to-dos ----------
  async function todoOwner(s: AppState, a: { trip?: string; template?: string }) {
    if (a.trip && a.template) throw new ToolError('Give either trip or template, not both.');
    if (a.template)
      return {
        template: find<Template>(s.templates, a.template, (t) => t.name, 'template'),
      };
    return { trip: (await resolveTrip(a.trip)).t };
  }

  server.registerTool(
    'list_todos',
    {
      description:
        'List to-dos (Pre-trip, During trip, After trip) for a trip or a template, sorted by date. Defaults to the next trip.',
      inputSchema: z.object({
        trip: z.string().optional().describe('Trip name or id'),
        template: z.string().optional().describe('Template name or id'),
      }),
    },
    async (a) => {
      try {
        const s = await state();
        const o = await todoOwner(s, a);
        if (o.template)
          return text({
            template: o.template.name,
            todos: sortTemplateTodos(o.template.todos).map((t) => todoView(t)),
          });
        const d = await trip(o.trip!.id);
        return text({
          trip: d.trip.name,
          start_date: d.trip.start_date,
          end_date: d.trip.end_date,
          todos: sortTripTodos(d.todos, d.trip).map((t) => todoView(t, d.trip)),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'add_todos',
    {
      description:
        'Add to-dos to a trip or a template. phase is pre (before the trip), during or after. Give a fixed date, a relative one (days before/on/after the start, middle or end of the trip), or neither.',
      inputSchema: z.object({
        trip: z.string().optional().describe('Trip name or id; defaults to the next trip'),
        template: z.string().optional().describe('Template name or id'),
        todos: z
          .array(
            z.object({
              title: z.string().min(1),
              phase: z.enum(TODO_PHASES).default('pre'),
              ...todoDateInput,
              notes: z.string().optional(),
            }),
          )
          .min(1)
          .max(100),
      }),
    },
    async (a) => {
      try {
        const s = await state();
        const o = await todoOwner(s, a);
        const path = o.template
          ? `/templates/${o.template.id}/todos`
          : `/trips/${o.trip!.id}/todos`;
        for (const t of a.todos)
          await call('POST', path, {
            title: t.title,
            phase: t.phase,
            ...whenFrom(t),
            notes: t.notes ?? null,
          });
        return text(
          `Added ${a.todos.length} to-do${a.todos.length === 1 ? '' : 's'} to ${o.template?.name ?? o.trip!.name}.`,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'update_todo',
    {
      description:
        'Change a to-do on a trip or template: mark it done (trips), rename it, move it to another phase, change or remove its date, or edit notes. Use ids from list_todos.',
      inputSchema: z.object({
        todo_id: z.string(),
        done: z.boolean().optional(),
        title: z.string().min(1).optional(),
        phase: z.enum(TODO_PHASES).optional(),
        ...todoDateInput,
        notes: z.string().nullable().optional(),
      }),
    },
    async (a) => {
      try {
        const s = await state();
        const onTemplate = s.templates.some((t) => t.todos.some((x) => x.id === a.todo_id));
        if (onTemplate && a.done !== undefined)
          throw new ToolError('Template to-dos can’t be done; only trip to-dos can.');
        const body = {
          ...(a.done !== undefined ? { done: a.done } : {}),
          ...(a.title !== undefined ? { title: a.title } : {}),
          ...(a.phase !== undefined ? { phase: a.phase } : {}),
          ...whenFrom(a),
          ...(a.notes !== undefined ? { notes: a.notes } : {}),
        };
        if (onTemplate) {
          await call('PATCH', `/template-todos/${a.todo_id}`, body);
          return text('Updated the template to-do.');
        }
        const d = await call<TripDetail>('PATCH', `/trip-todos/${a.todo_id}`, body).catch(() => {
          throw new ToolError('No to-do has that id. Use list_todos to find ids.');
        });
        const t = d.todos.find((x) => x.id === a.todo_id)!;
        return text({ updated: todoView(t, d.trip) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'remove_todo',
    {
      description: 'Delete a to-do from a trip or template.',
      inputSchema: z.object({ todo_id: z.string() }),
    },
    async ({ todo_id }) => {
      try {
        const s = await state();
        const onTemplate = s.templates.some((t) => t.todos.some((x) => x.id === todo_id));
        await call('DELETE', onTemplate ? `/template-todos/${todo_id}` : `/trip-todos/${todo_id}`);
        return text('Removed.');
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ---------- itinerary ----------
  async function resolveSection(d: TripDetail, key: string) {
    return find(d.itinerary, key, (x) => x.title, 'itinerary section');
  }

  server.registerTool(
    'get_itinerary',
    {
      description:
        'A trip’s itinerary: sections in order, each with its entries in order (new ones go where their time falls; connecting flights stay back to back) (flights and other transport with durations and layovers, lodging, plans, notes), plus ids for editing.',
      inputSchema: z.object({
        trip: z.string().optional().describe('Trip name or id; defaults to the next trip'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (a) => {
      try {
        const { t } = await resolveTrip(a.trip);
        const d = await trip(t.id);
        return text({
          trip: d.trip.name,
          start_date: d.trip.start_date,
          end_date: d.trip.end_date,
          destination: d.trip.destination,
          sections: itineraryView(d.itinerary),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'add_itinerary_section',
    {
      description:
        'Add a section to a trip’s itinerary: travel (getting from one place to another, e.g. "Getting there", "Lisbon → Porto", "Heading home") or a stay (time in one place, e.g. "Lisbon"). New sections go at the end unless you give a position.',
      inputSchema: z.object({
        trip: z.string().optional().describe('Trip name or id; defaults to the next trip'),
        kind: z.enum(SECTION_KINDS),
        title: z.string().min(1),
        notes: z.string().optional(),
        position: z.number().int().min(1).optional().describe('1 = first'),
      }),
    },
    async (a) => {
      try {
        const { t } = await resolveTrip(a.trip);
        let d = await call<TripDetail>('POST', `/trips/${t.id}/itinerary`, {
          kind: a.kind,
          title: a.title,
          notes: a.notes ?? null,
        });
        const ordered = sortSections(d.itinerary);
        const added = ordered.at(-1)!;
        if (a.position && a.position < ordered.length) {
          const ids = ordered.slice(0, -1).map((x) => x.id);
          ids.splice(a.position - 1, 0, added.id);
          d = await call<TripDetail>('POST', `/trips/${t.id}/itinerary/order`, { ids });
        }
        return text({
          added: { section_id: added.id, title: added.title },
          sections: sortSections(d.itinerary).map((x) => x.title),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'update_itinerary_section',
    {
      description:
        'Rename an itinerary section, change its kind or notes, or move it to another position.',
      inputSchema: z.object({
        trip: z.string().optional(),
        section: z.string().describe('Section title or id'),
        kind: z.enum(SECTION_KINDS).optional(),
        title: z.string().min(1).optional(),
        notes: z.string().nullable().optional(),
        position: z.number().int().min(1).optional().describe('1 = first'),
      }),
    },
    async (a) => {
      try {
        const { t } = await resolveTrip(a.trip);
        let d = await trip(t.id);
        const sec = await resolveSection(d, a.section);
        const body = {
          ...(a.kind !== undefined ? { kind: a.kind } : {}),
          ...(a.title !== undefined ? { title: a.title } : {}),
          ...(a.notes !== undefined ? { notes: a.notes } : {}),
        };
        if (Object.keys(body).length)
          d = await call<TripDetail>('PATCH', `/itinerary-sections/${sec.id}`, body);
        if (a.position) {
          const ids = sortSections(d.itinerary)
            .map((x) => x.id)
            .filter((x) => x !== sec.id);
          ids.splice(Math.min(a.position - 1, ids.length), 0, sec.id);
          d = await call<TripDetail>('POST', `/trips/${t.id}/itinerary/order`, { ids });
        }
        return text({ sections: sortSections(d.itinerary).map((x) => x.title) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'remove_itinerary_section',
    {
      description: 'Delete an itinerary section and everything in it. Ask first if it has entries.',
      inputSchema: z.object({
        trip: z.string().optional(),
        section: z.string().describe('Section title or id'),
      }),
    },
    async (a) => {
      try {
        const { t } = await resolveTrip(a.trip);
        const sec = await resolveSection(await trip(t.id), a.section);
        await call('DELETE', `/itinerary-sections/${sec.id}`);
        return text(`Removed ${sec.title} and its ${sec.entries.length} entries.`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'add_itinerary_entries',
    {
      description:
        'Add entries to an itinerary section: transport (one per flight or train segment, with depart and arrive local times; layovers are worked out), lodging (check-in and check-out), plans (reservations, tickets, tours, rentals) or notes. The section is created if no section has that title (give section_kind). Entries matching an existing one (same confirmation and start, or same carrier, number and date) are skipped, so it is safe to run again.',
      inputSchema: z.object({
        trip: z.string().optional().describe('Trip name or id; defaults to the next trip'),
        section: z.string().describe('Section title or id, e.g. "Getting there"'),
        section_kind: z
          .enum(SECTION_KINDS)
          .optional()
          .describe('If the section is new: travel or stay'),
        entries: z
          .array(z.object({ kind: z.enum(ENTRY_KINDS), ...entryFields }))
          .min(1)
          .max(50),
      }),
    },
    async (a) => {
      try {
        const { t } = await resolveTrip(a.trip);
        let d = await trip(t.id);
        let sec = d.itinerary.find(
          (x) => x.id === a.section || x.title.toLowerCase() === a.section.trim().toLowerCase(),
        );
        if (!sec) {
          d = await call<TripDetail>('POST', `/trips/${t.id}/itinerary`, {
            kind:
              a.section_kind ??
              (a.entries.every((e) => e.kind === 'transport') ? 'travel' : 'stay'),
            title: a.section.trim(),
          });
          sec = sortSections(d.itinerary).at(-1)!;
        }
        const existing = d.itinerary.flatMap((x) => x.entries);
        const same = (e: (typeof a.entries)[number]) =>
          existing.some(
            (x) =>
              x.kind === e.kind &&
              x.start.date === (e.start?.date ?? null) &&
              ((e.confirmation &&
                x.confirmation === e.confirmation &&
                x.start.time === (e.start?.time ?? null) &&
                (x.number ?? null) === (e.number ?? null)) ||
                (e.carrier &&
                  e.number &&
                  x.carrier?.toLowerCase() === e.carrier.toLowerCase() &&
                  x.number === e.number) ||
                (e.title && x.title?.toLowerCase() === e.title.toLowerCase())),
          );
        const added: string[] = [];
        const skipped: string[] = [];
        for (const e of a.entries) {
          const label = e.title ?? ([e.carrier, e.number].filter(Boolean).join(' ') || e.kind);
          if (same(e)) {
            skipped.push(label);
            continue;
          }
          d = await call<TripDetail>('POST', `/itinerary-sections/${sec.id}/entries`, {
            ...e,
            start: endBody(e.start),
            end: endBody(e.end),
          });
          added.push(label);
        }
        const now = d.itinerary.find((x) => x.id === sec.id)!;
        return text({
          section: now.title,
          added,
          ...(skipped.length ? { skipped_as_already_there: skipped } : {}),
          entries: itineraryView([now])[0]!.entries,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'update_itinerary_entry',
    {
      description:
        'Change an itinerary entry (ids from get_itinerary): times, places, booking numbers, notes, or move it to another section. For start and end, only the fields you give change.',
      inputSchema: z.object({
        entry_id: z.string(),
        move_to_section: z.string().optional().describe('Section title or id'),
        trip: z
          .string()
          .optional()
          .describe('Needed only with move_to_section, if not the next trip'),
        kind: z.enum(ENTRY_KINDS).optional(),
        ...entryFields,
      }),
    },
    async (a) => {
      try {
        const { entry_id, move_to_section, trip: tripKey, ...f } = a;
        const body: Record<string, unknown> = Object.fromEntries(
          Object.entries({ ...f, start: endBody(f.start), end: endBody(f.end) }).filter(
            ([, v]) => v !== undefined,
          ),
        );
        if (move_to_section) {
          const { t } = await resolveTrip(tripKey);
          body.section_id = (await resolveSection(await trip(t.id), move_to_section)).id;
        }
        const d = await call<TripDetail>('PATCH', `/itinerary-entries/${entry_id}`, body);
        const sec = d.itinerary.find((x) => x.entries.some((e) => e.id === entry_id))!;
        return text({
          updated: itineraryView([sec])[0]!.entries.find((e) => e.entry_id === entry_id),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'remove_itinerary_entry',
    {
      description: 'Delete an itinerary entry.',
      inputSchema: z.object({ entry_id: z.string() }),
    },
    async ({ entry_id }) => {
      try {
        await call('DELETE', `/itinerary-entries/${entry_id}`);
        return text('Removed.');
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerPrompt(
    'add_bookings',
    {
      title: 'Add bookings to the itinerary',
      description:
        'Find flight, train, hotel, rental and reservation confirmations in your connected email (or ones you paste) and add them to a trip’s itinerary.',
      argsSchema: z.object({
        trip: tripArg,
        pasted: z
          .string()
          .optional()
          .describe('Paste a confirmation here instead of searching email.'),
      }),
    },
    ({ trip: t, pasted }) =>
      ask(`Fill in the itinerary for ${t ? `"${t}"` : 'our next trip'} in Duffel from our booking confirmations.

1. get_itinerary${t ? ` for "${t}"` : ''} to see the trip's dates, destination and what's already there.
2. ${
        pasted
          ? `Read this confirmation:\n\n${pasted}\n\n`
          : `Search my connected email (Gmail, Outlook, Fastmail or similar) for confirmations around the trip's dates and destination: airline and train tickets, hotels and rentals (Airbnb, VRBO), car rentals, ferries, tours, tickets and restaurant reservations. Prefer the latest email for each booking (changes and cancellations win). If you can't search email, ask me to paste the confirmations.`
      }
3. Pull out each booking: carrier and number, airports or stations (IATA codes), local dates and times as printed, each place's IANA time zone, confirmation numbers, seats, terminal, addresses and anything worth noting (baggage, check-in times). One transport entry per flight or train segment.
4. Propose where each goes: travel sections ("Getting there", "Lisbon → Porto", "Heading home") and a stay section per place, in trip order. Reuse sections already there. Show me the plan as a short list and wait for my OK.
5. Add them with add_itinerary_section and add_itinerary_entries (entries already there are skipped). Then show the itinerary with get_itinerary, pointing out tight layovers and anything that doesn't line up with the trip's dates.`),
  );

  return server;
}

/** The OAuthProvider apiHandler for /mcp. Only reached with a valid token. */
export const mcpApiHandler = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext): Promise<Response> {
    const origin = new URL(request.url).origin;
    const call = apiCaller(origin, env, ctx);
    const handler = createMcpHandler(() => buildServer(call));
    return handler.fetch(request);
  },
};

# Duffel

Conventions for working on Duffel, shared with the owner's other self-hosted Cloudflare apps
(Nitrogen, Ratio, HSA Locker). Follow them when building or changing anything here.

## Workflow

- Start with `git pull --ff-only`.
- Every round of changes gets a new version number, without being asked: when you start making
  changes after the last push to `main`, bump the patch version in `package.json` first
  (1.0.1 → 1.0.2), so each push ships under its own version. Bump minor or major only when the
  owner asks. Mention the new version when you report or push.
- The MCP server reports its own version: `src/worker/mcp.ts` reads it from `package.json`, and
  `test/api/mcp.test.ts` checks they match.
- Verify with typecheck, lint, tests and `curl`; don't open a browser unless the owner asks.
- Push to `main` only when the owner says so. Deploying (`npm run deploy`) is a separate step,
  also only when asked.
- Files headed "Selfhost Kit: synced from tyler-class/selfhost-kit" (`src/*/kit/*`,
  `scripts/release.ts`, `.github/workflows/update.yml`) are overwritten by the kit's sync: make
  those changes in the kit, not here.

## Motion

- Sheets and dialogs "lift" on every screen size: the backdrop fades in and the panel rises into
  place (`.scrim-in` and `.sheet-in` in `styles.css`). Respect `prefers-reduced-motion`.
- Collapsible sections (Pack groups, template folders): the whole header row toggles, the chevron
  turns 180° (down when closed, up when open), the content slides open and shut, and the open
  state is remembered on the device. Use `Collapse` and `FoldChevron` from `components/ui.tsx`.
- Drag to reorder (`SortableGroups.tsx`, `Itinerary.tsx`): drag by a grip handle (the `grip` icon,
  `DragHandle` in `components/ui.tsx`), show a dashed slot where the item will land and a lifted
  copy under the pointer, and **no drop animation** (`dropAnimation={null}`), which would slide the
  copy back to where the item started before the new order shows. Keep the touch press-delay,
  keyboard support and optimistic save with rollback.

## Controls

- Never a native `<select>`: use the app's own pickers (`SelectSheet`, `OnePicker`).
- Toggle sliders and segmented controls draw their keyboard focus ring **inside** the button (an
  inset ring, the `focus-inset` class), because their tracks scroll sideways and clip anything
  outside. Same for any control inside an `overflow-hidden` wrapper.
- Removing something (deleting, archiving, bulk changes) shows a toast with **Undo** where the
  change can be undone. Not yet: bulk moves and reassignments on Pack, and swipe-deletes on a
  template's items and bags. Deleting a catalog item that's on templates asks first instead (Undo
  couldn't put it back on them).
- A filter shows the same choices and counts everywhere the same data appears.

## Layout and look

- No `border-top` divider on a row with rounded corners: it bends. Draw the divider as a separate
  straight line.
- Hover shades on icon buttons stay clear of dividing lines (size and offset them with room).
- Every page heading and section heading has an icon, detail pages too.
- Empty states: an icon in a soft circle, a headline and one line. A card or section with nothing
  to show is hidden rather than shown empty.
- Phones: text wraps rather than running off the edge; notes and other longer text fields grow with
  the text instead of scrolling (`TextArea` in `components/ui.tsx`). Secondary lines (dates,
  counts, where) sit left-aligned on their own line.
- When a row of chips (tags, people) runs out of room, show what fits and fold the rest into a
  "+N" pill that shows them in a small pop-out.
- Any grain or texture goes on backgrounds only, never over text or components, and stays subtle.

## Behaviour

- After a save, everything on screen updates straight away (update or invalidate the query
  cache); nothing needs a reload.
- An item can be changed the same way wherever it appears: one shared sheet or hook, not a copy
  per screen. Pack's `ItemSheet`, Templates' `TemplateItemSheet` and Catalog's `ItemForm` share
  `GroupField` and `NotesField` (`components/fields.tsx`); their quantity, people and auto pack
  controls are still separate copies and should move there too.
- View choices (status, where, group by, collapsed groups) are remembered on the device, and put in
  the address when it makes sense to bookmark or share the view.

## Wording

- Product nouns are capitalized ("Trips", "Catalog", "Templates").
- Ranges of dates and times read "Dec 12 to 19" and "9:00 to 10:30 AM", not with a dash
  (`formatRange` in `lib/format.ts`, `timeRange` in `lib/itinerary.ts`).
- Relative times, if shown, are compact: "3h ago", "5m ago".

## Assistants (MCP)

- Archived things (catalog items, past trips) stay out of the normal tools. Give them a dedicated
  tool that finds them, says they're archived and how to bring one back if the owner asks, and say
  so in the server's instructions (`search_archive` and `restore_archived`).

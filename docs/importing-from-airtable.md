# Importing from Airtable

Duffel started as an Airtable base. If you kept your packing lists in a base shaped like it, `scripts/airtable-to-sql.ts` converts it into a Duffel backup.

## What the base needs

Tables and fields, by name (extra fields are ignored):

| Table              | Fields                                                                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **People**         | Name, Role, Notes                                                                                                                                                                                           |
| **Items**          | Item, Category, Quantity Mode (Fixed / Per day / Per night), Qty, Max Qty, For (people), Climate Tags, Activity Tags, Length/Width/Height (in), Dimensions Source, Notes, Not in suitcase, Usually carry-on |
| **Suitcases**      | Suitcase, Type, Length/Width/Height (in), Capacity (L), Max Weight (lb), Notes                                                                                                                              |
| **Templates**      | Template, Trip Type, Climate, Activities, Notes                                                                                                                                                             |
| **Template Items** | Label, Template, Item, Quantity Mode Override, Qty Override, Carry-on, Assignee, Notes                                                                                                                      |
| **Trips**          | Trip, Template, Cloned From (trip name), Start Date, End Date, Days, Nights, Travelers, Destination, Status, Notes                                                                                          |
| **Trip Suitcases** | Label, Trip, Suitcase, Role, Notes                                                                                                                                                                          |
| **Trip Items**     | Label, Trip, Item, Assignee, Trip Suitcase, Qty, Qty Override, Packed, Carry-on, Notes                                                                                                                      |

## Steps

1. Export every table to one JSON file at `data/airtable-export.json` (the `data/` folder is gitignored):

   ```json
   {
     "tables": {
       "People": [{ "id": "rec…", "createdTime": "…", "fields": { "Name": "…" } }],
       "Items": []
     }
   }
   ```

   Linked records are arrays of record ids; single and multiple selects are their option names. The Airtable API's list-records output has this shape.

2. Convert it:

   ```sh
   npx tsx scripts/airtable-to-sql.ts data/airtable-export.json data/duffel-import
   ```

   This writes `data/duffel-import.json` (a Duffel backup) and `data/duffel-import.sql`, and lists anything it had to adjust.

   To set people’s colors and emoji, pass them by first name:

   ```sh
   DUFFEL_PEOPLE_LOOK='{"sam":{"color":"blue","emoji":"🧔"}}' npx tsx scripts/airtable-to-sql.ts
   ```

   Colors: blue, violet, coral, amber, green, rose, teal, slate.

3. Try it locally first:

   ```sh
   npm run db:migrate:local
   npx wrangler d1 execute DB --local --file data/duffel-import.sql
   npm run dev
   ```

4. Load it into your deployed Duffel, either way:
   - **In the app:** More → Settings → Restore from backup, and pick `data/duffel-import.json`. This replaces everything.
   - **From the command line**, into an empty database: `npx wrangler d1 execute DB --remote --file data/duffel-import.sql`

## How things map

- Trip item labels like “T-shirts - Sam” become the name “T-shirts”. The person comes from Assignee.
- A row with several assignees becomes one **Shared** row, so quantities aren’t doubled.
- Carry-on now belongs to the bag. A bag is carry-on when its role or suitcase type is Carry-on, Personal item, Backpack or Diaper bag. Rows whose carry-on checkbox disagrees with their bag are listed.
- Items marked “Not in suitcase” with no bag become **No bag**.
- Quantities are recalculated from the catalog item and trip length. Where your Airtable number differs, it’s kept as a manual quantity.
- “Cloned From” is matched to a trip by name.

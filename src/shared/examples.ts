// Example requests people can make of an assistant connected to Duffel. One list feeds the MCP
// server instructions, the get_started tool and the "Try asking" list in Settings.

export interface ExamplePrompt {
  /** What to say, written the way a person would ask. <angle brackets> mark what to fill in. */
  prompt: string;
  /** Why it's worth asking, in a few words. */
  why: string;
}

export const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  {
    prompt:
      'Make a packing list for our trip to <place>, <start date> to <end date>, from our <template> template.',
    why: 'A full list for everyone, in their bags.',
  },
  {
    prompt:
      'Find our flight, hotel and reservation confirmations for <trip> in my email and add them to the itinerary.',
    why: 'Needs your email connected to the same assistant.',
  },
  {
    prompt: 'What’s still not packed for <trip>? Group it by person.',
    why: 'See what’s left before zipping up.',
  },
  {
    prompt:
      'Add to-dos for <trip>: book the pet sitter two weeks before, hold the mail, and check in online the day before we leave.',
    why: 'Dates follow the trip if it moves.',
  },
  {
    prompt:
      'Copy <past trip> for <new trip> on <dates>, without <person>’s things since they’re not coming.',
    why: 'Reuse what worked, everything unpacked.',
  },
  {
    prompt: 'It’ll be <cold / rainy / hot> on <trip>. What from our catalog should we add?',
    why: 'Catches what the weather calls for.',
  },
  {
    prompt: 'Here’s my booking confirmation: <paste it>. Add it to <trip>’s itinerary.',
    why: 'Flights, layovers and booking numbers, filled in.',
  },
  {
    prompt: 'Mark everything in <bag> on <trip> as packed.',
    why: 'Check off a whole bag at once.',
  },
  {
    prompt:
      'Sort <trip>’s list into groups like Clothing, Toiletries and Documents, in the order we pack.',
    why: 'A tidier list to pack from.',
  },
  {
    prompt: 'Save <trip> as a template called <name>, with its to-dos.',
    why: 'The next trip starts mostly done.',
  },
];

/** The ready-made MCP prompts, for listing alongside the examples. */
export const MCP_PROMPTS: { name: string; title: string; does: string }[] = [
  {
    name: 'plan_trip',
    title: 'Plan a trip',
    does: 'Builds the packing list from a template or past trip, then suggests extras and to-dos.',
  },
  {
    name: 'whats_left',
    title: 'What’s left to pack',
    does: 'Lists what isn’t packed by person and bag, plus overdue to-dos.',
  },
  {
    name: 'add_trip_todos',
    title: 'Add the usual to-dos',
    does: 'Proposes to-dos before, during and after a trip, with dates that follow it.',
  },
  {
    name: 'add_bookings',
    title: 'Add bookings to the itinerary',
    does: 'Finds confirmations in your connected email (or ones you paste) and adds flights, stays and reservations.',
  },
  {
    name: 'organize_groups',
    title: 'Organize into groups',
    does: 'Proposes groups and their order for a trip or template, then applies them.',
  },
];

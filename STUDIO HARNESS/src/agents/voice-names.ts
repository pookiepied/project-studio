/**
 * The short names voice tasks are called by.
 *
 * Chosen here, at admission, and stored as the task's title, so the voice
 * agent and the call screen say the same name and the person can say "steer
 * Hazel". A name is a label for people only: it grants nothing, and the task
 * is still addressed by its id.
 */
const NAMES = ("Ada Aiden Alba Alex Ali Alma Amara Amir Ana Andi Anika Aria Ari Arun Asa Ash Aspen Aster Atlas Avery Bea Ben Blair Bo Bowie Briar Brook Cami Casey Cass Cedar Charlie Chris Cleo Cody Cory Cy Dana Dani Dara Devon Drew Eden Eli Ellis Ember Emery Erin Evan Ezra Fern Finn Flora Flynn Frankie Gale Gray Hadley Harper Hazel Hollis Hugo Indigo Iris Isla Jamie Jay Jean Jesse Jo Jules Jun Kai Kaya Kit Lane Lee Leo Linden Logan Lou Luca Luna Lyra Mae Maren Max Micah Mika Milo Mira Morgan Nico Noel Nova Oakley Oli Onyx Orion Parker Pax Perry Quinn Rae Rain Remi Ren Riley River Robin Rory Rowan Sage Sam Sasha Scout Shiloh Sky Sloane Sol Stevie Sunny Tali Taylor Teo Terry Theo Toby Toni Tracy Val Wren Yael Zara Zuri").split(" ");

/** A name for the task `id` that no name in `taken` already uses. */
export function voiceTaskName(id: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  for (let round = 1; ; round++) {
    for (let step = 0; step < NAMES.length; step++) {
      const base = NAMES[(hash + step) % NAMES.length] ?? "Agent";
      const name = round === 1 ? base : `${base} ${round}`;
      if (!used.has(name)) return name;
    }
  }
}

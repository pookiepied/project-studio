/** Display identity is separate from the agent type and never grants authority. */
const NAMES = ('Ada Aiden Alba Alex Ali Alma Amara Amir Ana Andi Anika Aria Ari Arun Asa Ash Aspen Aster Atlas Avery Bea Ben Blair Bo Bowie Briar Brook Cami Casey Cass Cedar Charlie Chris Cleo Cody Cory Cy Dana Dani Dara Devon Drew Eden Eli Ellis Ember Emery Erin Evan Ezra Fern Finn Flora Flynn Frankie Gale Gray Hadley Harper Hazel Hollis Hugo Indigo Iris Isla Jamie Jay Jean Jesse Jo Jules Jun Kai Kaya Kit Lane Lee Leo Linden Logan Lou Luca Luna Lyra Mae Maren Max Micah Mika Milo Mira Morgan Nico Noel Nova Oakley Oli Onyx Orion Parker Pax Perry Quinn Rae Rain Remi Ren Riley River Robin Rory Rowan Sage Sam Sasha Scout Shiloh Sky Sloane Sol Stevie Sunny Tali Taylor Teo Terry Theo Toby Toni Tracy Val Wren Yael Zara Zuri').split(' ')

export interface ParticipantProfile { readonly name: string; readonly initials: string; readonly hue: number; readonly mark: number }

export function participantProfiles(ids: readonly string[], previous: ReadonlyMap<string, ParticipantProfile> = new Map()): ReadonlyMap<string, ParticipantProfile> {
  const used = new Set([...previous.values()].map((profile) => profile.name))
  return new Map([...new Set(ids)].sort().map((id) => {
    const assigned = previous.get(id)
    if (assigned !== undefined) return [id, assigned] as const
    let hash = 2166136261
    for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0
    let slot = hash % NAMES.length
    let suffix = 0
    let name = NAMES[slot] ?? 'Agent'
    while (used.has(name)) {
      slot = (slot + 1) % NAMES.length
      if (slot === hash % NAMES.length) suffix++
      name = `${NAMES[slot] ?? 'Agent'}${suffix === 0 ? '' : ` ${suffix + 1}`}`
    }
    used.add(name)
    return [id, { name, initials: name.slice(0, 2), hue: hash % 360, mark: hash % 5 }] as const
  }))
}

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { resolveHarnessAddress } from '@/platform/harness'
import { createRequester } from '@/platform/harness/client/request'
import { isRecord } from '@/lib/guards'
import { participantProfiles, type ParticipantProfile } from './participants'
import { CritterAvatar, moodOf } from './avatars'
import { playCue } from './callSounds'

export interface Participant { id: string; agentName: string; stage: string; updatedAt: number; createdAt: number; name?: string }

function parse(value: unknown): Participant[] {
  if (!isRecord(value) || !Array.isArray(value.tasks)) return []
  return value.tasks.flatMap((row: unknown) => {
    if (!isRecord(row) || typeof row.id !== 'string' || typeof row.agentName !== 'string' || typeof row.stage !== 'string' || typeof row.updatedAt !== 'number' || typeof row.createdAt !== 'number') return []
    return [{ id: row.id, agentName: row.agentName, stage: row.stage, updatedAt: row.updatedAt, createdAt: row.createdAt, ...(typeof row.name === 'string' && row.name !== '' ? { name: row.name } : {}) }]
  })
}

/**
 * A voice task's name comes from the harness, which chose it at admission
 * and tells the voice agent the same one; the face and colour stay local.
 */
export function withNames(profiles: ReadonlyMap<string, ParticipantProfile>, tasks: readonly Participant[]): ReadonlyMap<string, ParticipantProfile> {
  const named = new Map(profiles)
  for (const task of tasks) {
    const profile = named.get(task.id)
    if (profile !== undefined && task.name !== undefined && profile.name !== task.name) named.set(task.id, { ...profile, name: task.name, initials: task.name.slice(0, 2) })
  }
  return named
}

export const STAGE_LABELS: Record<string, string> = { working: 'Working', using_tool: 'Using a tool', waiting_for_model: 'Thinking', completed: 'Done', failed: 'Failed', cancelled: 'Stopped' }
const SETTLED = ['completed', 'failed', 'cancelled']
/** What kind of agent a tile is: a voice task is the full Studio agent; the rest are its delegates. */
export const agentKind = (agentName: string): string => agentName === 'voice-work' ? 'Studio agent' : `${agentName.charAt(0).toUpperCase()}${agentName.slice(1)} agent`

/**
 * The workers on the call: the conversation's tasks, polled, with the ones
 * that settled more than a minute ago gone from the room.
 *
 * Arrivals and departures are heard as well as seen. The first read is the
 * room as it was when the call opened, so it is silent; after that a new
 * worker plays the join cue and one that settles plays the leave cue.
 */
export function useCallParticipants(conversationId: string | null, active: boolean, sounds = true) {
  const [participants, setParticipants] = useState<Participant[]>([])
  const [unavailable, setUnavailable] = useState(false)
  const [profiles, setProfiles] = useState<ReadonlyMap<string, ParticipantProfile>>(() => participantProfiles([]))
  const soundsRef = useRef(sounds)
  soundsRef.current = sounds

  useEffect(() => {
    if (!active || conversationId === null) return
    let closed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let known: Map<string, boolean> | null = null
    const poll = async () => {
      try {
        const address = await resolveHarnessAddress()
        if (closed) return
        if (address === null) { setUnavailable(true); return }
        const result = await createRequester(address).json('GET', `/api/tasks/activity?parentConversationId=${encodeURIComponent(conversationId)}`, undefined, parse)
        if (closed) return
        setUnavailable(!result.ok)
        if (result.ok) {
          const tasks = result.value.filter((task) => !SETTLED.includes(task.stage) || Date.now() - task.updatedAt < 60_000)
          const now = new Map(tasks.map((task) => [task.id, !SETTLED.includes(task.stage)] as const))
          if (known !== null && soundsRef.current) {
            const previous = known
            if (tasks.some((task) => !previous.has(task.id) && now.get(task.id) === true)) playCue('agentJoin')
            else if ([...previous].some(([id, busy]) => busy && now.get(id) !== true)) playCue('agentLeave')
          }
          known = now
          setParticipants(tasks)
          setProfiles((previous) => withNames(participantProfiles(tasks.map((task) => task.id), previous), tasks))
        }
      } catch { if (!closed) setUnavailable(true) }
      finally { if (!closed) timer = setTimeout(() => { void poll() }, 1500) }
    }
    void poll()
    return () => { closed = true; clearTimeout(timer) }
  }, [active, conversationId])

  return { participants, profiles, unavailable }
}

/**
 * The workers as tiles. Compact is a row of faces with a name under each;
 * expanded is a grid of cards that also say what each one is doing.
 */
export function ParticipantTiles({ participants, profiles, expanded }: {
  participants: readonly Participant[]
  profiles: ReadonlyMap<string, ParticipantProfile>
  expanded: boolean
}) {
  return (
    <motion.ul
      layout
      aria-label="Agents on the call"
      className={expanded ? 'grid w-[min(22rem,100%)] grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2' : 'flex flex-wrap justify-end gap-3'}
      transition={{ duration: DURATION.base, ease: EASE_OUT }}
    >
      <AnimatePresence initial={false}>
        {participants.map((task) => {
          const profile = profiles.get(task.id)
          if (profile === undefined) return null
          const label = STAGE_LABELS[task.stage] ?? 'Unknown'
          return (
            <motion.li
              key={task.id}
              layout
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: DURATION.base, ease: EASE_OUT }}
              title={`${profile.name}, ${agentKind(task.agentName)}: ${label}`}
              className={expanded
                ? 'flex flex-col items-center gap-1.5 rounded-xl border border-border bg-surface-raised px-2 py-3 text-center'
                : 'flex w-16 flex-col items-center gap-1 text-center'}
            >
              <CritterAvatar profile={profile} mood={moodOf(task.stage)} size={expanded ? 44 : 36} />
              <span className="max-w-full truncate text-caption text-foreground">{profile.name}</span>
              <span className="max-w-full truncate text-micro text-muted-foreground">{label}</span>
              {expanded ? <span className="max-w-full truncate text-micro text-muted-foreground/70">{agentKind(task.agentName)}</span> : null}
            </motion.li>
          )
        })}
      </AnimatePresence>
    </motion.ul>
  )
}

/** How many faces the stack shows before it ends in "+N". */
const STACK_FACES = 5

/**
 * The agents as faces beside Studio's own, on the same line: close enough to
 * read as one group with Studio, small enough not to compete with it. Each
 * face carries its state in its mood and a dot; its name and what it is
 * doing are on hover. No expanding: the faces are the summary, and the
 * chat's task details hold the rest.
 */
export function ParticipantStack({ participants, profiles }: {
  participants: readonly Participant[]
  profiles: ReadonlyMap<string, ParticipantProfile>
}) {
  const shown = participants.slice(0, STACK_FACES)
  const more = participants.length - shown.length
  return (
    <ul aria-label="Agents on the call" className="flex items-center -space-x-1.5">
      <AnimatePresence initial={false}>
        {shown.map((task) => {
          const profile = profiles.get(task.id)
          if (profile === undefined) return null
          const label = STAGE_LABELS[task.stage] ?? 'Unknown'
          const settled = SETTLED.includes(task.stage)
          return (
            <motion.li
              key={task.id}
              layout
              initial={{ opacity: 0, scale: 0.6, x: -6 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: DURATION.base, ease: EASE_OUT }}
              title={`${profile.name}, ${agentKind(task.agentName)}: ${label}`}
              aria-label={`${profile.name}: ${label}`}
              className="relative rounded-full bg-surface p-0.5"
            >
              <CritterAvatar profile={profile} mood={moodOf(task.stage)} size={28} />
              <span
                aria-hidden
                className={`absolute bottom-0 right-0 size-2 rounded-full ring-2 ring-surface ${task.stage === 'failed' ? 'bg-danger' : settled ? 'bg-muted-foreground' : 'animate-pulse bg-foreground'}`}
              />
            </motion.li>
          )
        })}
      </AnimatePresence>
      {more > 0 ? <li className="relative flex size-8 items-center justify-center rounded-full bg-tint text-micro text-muted-foreground ring-2 ring-surface">+{more}</li> : null}
    </ul>
  )
}

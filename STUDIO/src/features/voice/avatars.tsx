import { motion } from 'framer-motion'
import { StudioMark } from '@/components/brand/StudioMark'
import { LOOP } from '@/design/tokens'
import type { ParticipantProfile } from './participants'

/**
 * The faces of a voice call.
 *
 * Studio, the voice you talk to, wears the brand: the Studio staircase in
 * `currentColor`, so it is dark on the light theme and light on the dark one,
 * with a small sound badge that says this is the speaking Studio.
 *
 * Workers wear critters. A worker is a short-lived helper with a borrowed
 * human name, and a formal portrait would oversell it; a small creature that
 * looks busy while it works, pleased when it is done and glum when it failed
 * says the same status at a glance, and is friendlier company on a call.
 * Each creature is drawn from the worker's profile - its hue and one of five
 * ear shapes - so the same worker keeps the same face for the whole call.
 */

export type CritterMood = 'working' | 'done' | 'failed' | 'stopped'

export function StudioAvatar({ size = 40, busy = false }: { size?: number; busy?: boolean }) {
  return (
    <span
      aria-hidden
      className="relative flex shrink-0 items-center justify-center rounded-full bg-tint text-foreground"
      style={{ width: size, height: size }}
    >
      <StudioMark size={Math.round(size * 0.5)} busy={busy} />
      {/* The sound badge: three bars, the voice in the Studio. */}
      <span
        className="absolute -bottom-0.5 -right-0.5 flex items-end gap-[1.5px] rounded-full border border-surface bg-foreground px-[3px] py-[3px]"
        style={{ height: size * 0.36 }}
      >
        {[0.45, 1, 0.65].map((height, index) => (
          <span key={index} className="w-[2px] rounded-full bg-surface" style={{ height: `${height * 100}%` }} />
        ))}
      </span>
    </span>
  )
}

/** One of five ear shapes, drawn behind the head. */
function Ears({ kind, fill }: { kind: number; fill: string }) {
  switch (kind % 5) {
    case 0: // cat
      return <><path d="M9 14 L11 3 L19 10 Z" fill={fill} /><path d="M39 14 L37 3 L29 10 Z" fill={fill} /></>
    case 1: // bear
      return <><circle cx="12" cy="11" r="5.5" fill={fill} /><circle cx="36" cy="11" r="5.5" fill={fill} /></>
    case 2: // bunny
      return <><ellipse cx="17" cy="7" rx="3.6" ry="8" fill={fill} /><ellipse cx="31" cy="7" rx="3.6" ry="8" fill={fill} /></>
    case 3: // antenna
      return <><path d="M24 11 L24 3" stroke={fill} strokeWidth="2" strokeLinecap="round" /><circle cx="24" cy="3" r="2.6" fill={fill} /></>
    default: // sprout
      return <path d="M24 12 C 22 6, 17 5, 15 6 C 18 8, 21 9, 24 12 C 26 7, 30 4, 33 5 C 31 8, 27 10, 24 12 Z" fill={fill} />
  }
}

function Eyes({ mood }: { mood: CritterMood }) {
  if (mood === 'done') {
    // Closed and smiling: the satisfied squint.
    return <><path d="M15.5 25 q2.5 -3 5 0" /><path d="M27.5 25 q2.5 -3 5 0" /></>
  }
  if (mood === 'stopped') {
    return <><path d="M15.5 25 h5" /><path d="M27.5 25 h5" /></>
  }
  return (
    <>
      <circle cx="18" cy="25" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="30" cy="25" r="2.2" fill="currentColor" stroke="none" />
    </>
  )
}

function Mouth({ mood }: { mood: CritterMood }) {
  if (mood === 'failed') return <path d="M20.5 34 q3.5 -3 7 0" />
  if (mood === 'working') return <ellipse cx="24" cy="32.5" rx="1.6" ry="1.3" fill="currentColor" stroke="none" />
  return <path d="M20.5 31 q3.5 3.4 7 0" />
}

export function CritterAvatar({ profile, mood, size = 40 }: { profile: ParticipantProfile; mood: CritterMood; size?: number }) {
  const body = `hsl(${profile.hue} 62% 72%)`
  const shade = `hsl(${profile.hue} 55% 62%)`
  const ink = `hsl(${profile.hue} 35% 22%)`
  return (
    <motion.svg
      aria-hidden
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className="shrink-0"
      style={{ color: ink }}
      // Working critters bob, the one motion on the face; everyone else is still.
      animate={mood === 'working' ? { y: [0, -1.5, 0] } : { y: 0 }}
      transition={mood === 'working' ? LOOP.pulse : { duration: 0.2 }}
    >
      <g opacity={mood === 'stopped' ? 0.55 : 1}>
        <Ears kind={profile.mark} fill={shade} />
        <ellipse cx="24" cy="28" rx="17" ry="15.5" fill={body} />
        <circle cx="14.5" cy="31" r="2.6" fill="hsl(350 80% 78%)" opacity="0.7" />
        <circle cx="33.5" cy="31" r="2.6" fill="hsl(350 80% 78%)" opacity="0.7" />
        <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <Eyes mood={mood} />
          <Mouth mood={mood} />
        </g>
      </g>
    </motion.svg>
  )
}

/** The critter's mood for a worker's observed stage. */
export function moodOf(stage: string): CritterMood {
  if (stage === 'completed') return 'done'
  if (stage === 'failed') return 'failed'
  if (stage === 'cancelled') return 'stopped'
  return 'working'
}

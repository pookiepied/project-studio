import { useState } from 'react'
import { Icons } from '@/components/icons'
import { IconButton, Segmented } from '@/components/primitives'
import { Loading, StateNote } from '@/components/state'
import { Pane } from '@/features/settings/panes/Pane'
import { useSkills, type SkillsView } from '@/features/settings/skills/useSkills'
import type { SkillProblem, SkillRecord } from '@/platform/harness'

/**
 * Skills.
 *
 * The list is the user's DEFAULTS, as the MCP list is: a skill switched on
 * here is inherited by every project and conversation that has not decided
 * for itself. There is no add button and no remove, because the folder is
 * the installation - a person puts a skill in `~/.studio/skills/<name>/` and
 * it appears here on the next refresh; they delete the folder and it goes.
 * The pane says where that folder is, because the path is the whole of what
 * "install a skill" means and a person should not have to guess it.
 */
export function SkillsPane() {
  const skills = useSkills()

  return (
    <Pane
      title="Skills"
      description="Instructions the agent can load for a kind of work. What is on here is the default for new projects and conversations."
    >
      <Header busy={skills.refreshing} status={skills.view.status} onRefresh={() => void skills.refresh()} />
      <Body skills={skills} />
      <WhereTheyLive />
    </Pane>
  )
}

function Header({
  busy,
  status,
  onRefresh,
}: {
  busy: boolean
  status: SkillsView['status']
  onRefresh: () => void
}) {
  const label =
    status === 'ready' ? 'Installed on this machine' : status === 'loading' ? 'Reading what is installed' : ''

  return (
    <div className="flex items-center justify-between py-3.5">
      <p className="text-ui text-muted-foreground">{label}</p>
      <IconButton label="Refresh" onClick={onRefresh} disabled={busy}>
        <Icons.reload />
      </IconButton>
    </div>
  )
}

function Body({ skills }: { skills: ReturnType<typeof useSkills> }) {
  const { view } = skills

  if (view.status === 'loading') return <Loading label="Loading skills" />

  if (view.status === 'no-harness') {
    return (
      <StateNote
        title="The harness is not running."
        detail="Skills are read by the harness, so the list cannot be read until it starts."
      />
    )
  }

  if (view.status === 'failed') {
    return <StateNote title="The list could not be read." detail={view.error.message} />
  }

  const { listing } = view
  return (
    <>
      {listing.skills.length === 0 ? (
        <StateNote
          title="No skills installed."
          detail="Put a skill folder in the location below and refresh."
        />
      ) : (
        <div className="flex flex-col divide-y">
          {listing.skills.map((skill) => (
            <SkillRow
              key={skill.id}
              skill={skill}
              onToggle={(enabled) => void skills.setEnabled(skill.id, enabled)}
            />
          ))}
        </div>
      )}
      <Problems problems={listing.problems} />
    </>
  )
}

/**
 * One skill: what it is, whose it is, and whether it is on by default.
 *
 * The description is shown whole rather than truncated, because it is the
 * one sentence the model reads before deciding to load the skill, and a
 * person deciding whether to leave it on should read the same sentence.
 */
function SkillRow({ skill, onToggle }: { skill: SkillRecord; onToggle: (enabled: boolean) => void }) {
  // Held locally so the switch moves on the click; the list is re-read on
  // success, so the harness remains the authority.
  const [enabled, setEnabled] = useState(skill.enabledByDefault)

  return (
    <div className="flex items-start justify-between gap-6 py-3.5">
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span className="mt-0.5 shrink-0">
          <Icons.skill />
        </span>
        <div className="min-w-0">
          <p className="text-ui text-foreground">
            {skill.title}
            {skill.provenance === 'system' ? (
              <span className="ml-2 text-caption text-muted-foreground">Built into Studio</span>
            ) : null}
          </p>
          <p className="mt-0.5 text-caption text-muted-foreground">{skill.description}</p>
          <p className="mt-0.5 truncate text-caption text-muted-foreground" title={skill.directory}>
            {skill.directory}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Segmented
          layoutId={`skill-${skill.id}`}
          ariaLabel={`${skill.title} default`}
          value={enabled ? 'on' : 'off'}
          onChange={(value) => {
            const next = value === 'on'
            setEnabled(next)
            onToggle(next)
          }}
          options={[
            { id: 'off', label: 'Off' },
            { id: 'on', label: 'On' },
          ]}
        />
      </div>
    </div>
  )
}

/**
 * The folders that looked like skills and were not.
 *
 * Listed under the skills rather than hidden in a log, with the parser's
 * own sentence, because the person who made the typo is the one looking at
 * this screen and the sentence already says what to fix.
 */
function Problems({ problems }: { problems: readonly SkillProblem[] }) {
  if (problems.length === 0) return null
  return (
    <div className="mt-4">
      <p className="mb-1 text-caption text-muted-foreground">Skipped</p>
      <ul className="flex flex-col gap-1.5">
        {problems.map((problem) => (
          <li key={problem.directory} className="text-caption text-muted-foreground">
            <span className="text-foreground">{problem.directory}</span> - {problem.reason}
          </li>
        ))}
      </ul>
    </div>
  )
}

function WhereTheyLive() {
  return (
    <div className="mt-6 border-t pt-4">
      <p className="text-caption text-muted-foreground">
        A skill is a folder holding a <code>SKILL.md</code> file, in the same format Claude Code
        and other agents read. Put yours in <code>~/.studio/skills/&lt;name&gt;/</code> and refresh;
        the <code>create-skill</code> skill, switched on, tells the agent how to write one.
      </p>
    </div>
  )
}

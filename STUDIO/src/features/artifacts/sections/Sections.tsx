import { Icons } from '@/components/icons'
import { AnimatedItem, AnimatedList } from '@/features/artifacts/ArtifactMotion'
import { StatusDot } from '@/features/artifacts/sections/StatusDot'
import type {
  ArtifactFileChange,
  ArtifactSection,
  ArtifactStat,
  ArtifactTimelineItem,
} from '@/domain/artifacts/types'

/**
 * The generic body.
 *
 * This is what makes the artifact contract survive contact with a harness that
 * grows faster than the client: any artifact may carry `sections`, and an
 * artifact whose `kind` has no dedicated renderer is drawn entirely from them.
 * A new tool ships, emits a well-formed artifact, and gets a readable card on
 * day one with no client release.
 *
 * Dedicated renderers use these too, for the parts that are not special. A web
 * search draws its own result rows because a result row is the whole point of a
 * search, and then hands its timeline straight to `Timeline` — because a list
 * of steps with statuses is not a thing about searching.
 */
export function Sections({ sections }: { sections: readonly ArtifactSection[] }) {
  return (
    <div className="flex flex-col gap-3">
      {sections.map((section, index) => (
        <Section key={index} section={section} />
      ))}
    </div>
  )
}

function Section({ section }: { section: ArtifactSection }) {
  return (
    <div className="min-w-0">
      {section.title ? (
        <p className="mb-1.5 text-micro font-medium text-muted-foreground uppercase">
          {section.title}
        </p>
      ) : null}
      <Body section={section} />
    </div>
  )
}

function Body({ section }: { section: ArtifactSection }) {
  switch (section.type) {
    case 'text':
      return <p className="text-ui text-muted-foreground">{section.content}</p>

    case 'stats':
      return <Stats items={section.items} />

    case 'list':
      return (
        <AnimatedList className="gap-1.5">
          {section.items.map((item, index) => (
            <AnimatedItem key={index} index={index} className="text-ui text-muted-foreground">
              {item.label ? (
                <span className="font-medium text-foreground">{item.label}</span>
              ) : null}
              {item.label && (item.description ?? item.value) ? ' — ' : null}
              {item.description ?? item.value}
            </AnimatedItem>
          ))}
        </AnimatedList>
      )

    case 'links':
      return (
        <AnimatedList className="gap-0.5">
          {section.items.map((item, index) => (
            <AnimatedItem key={index} index={index}>
              <a
                href={item.href}
                target="_blank"
                rel="noreferrer noopener"
                className="group/link flex items-start gap-2 rounded-lg px-1.5 py-1.5 transition-colors duration-fast hover:bg-tint"
              >
                {/* One line tall, centred: the mark sits on the label's line
                    rather than being nudged toward it. `text-ui` on the wrapper
                    names which line that is, so `1lh` cannot resolve against
                    whatever size happens to be inherited here. */}
                <span className="flex h-[1lh] shrink-0 items-center text-ui">
                  <Icons.link />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui text-foreground">{item.label}</span>
                  <span className="block truncate text-caption text-muted-foreground">
                    {hostOf(item.href)}
                  </span>
                </span>
              </a>
            </AnimatedItem>
          ))}
        </AnimatedList>
      )

    case 'table':
      // Reusing the prose table rules rather than styling one here, so an
      // artifact's table and a markdown table are the same object. Two
      // near-identical table styles is exactly how a design system rots.
      //
      // No panel of its own: the shell already provides the sunken ground, and
      // a table is embedded content — it sits on that ground the way the
      // result rows and the timeline do, scrolling inside itself on x. A
      // second fill under it was the "separate box" look the hierarchy
      // retired.
      return (
        <div className="studio-prose studio-scroll-x w-full min-w-0 overflow-x-auto">
          <table>
            <thead>
              <tr>
                {section.table.columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.table.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell ?? '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )

    case 'timeline':
      return <Timeline items={section.items} />

    case 'file_changes':
      return <FileChanges items={section.items} />
  }
}

export function Stats({ items }: { items: readonly ArtifactStat[] }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      {items.map((stat) => (
        <div key={stat.label} className="min-w-0">
          <p className="text-micro text-muted-foreground uppercase">{stat.label}</p>
          {/* Tabular figures, so a row of counts does not jitter its own
              alignment as the numbers change during a stream. */}
          <p className="text-ui font-medium text-foreground tabular-nums">{stat.value}</p>
        </div>
      ))}
    </div>
  )
}

export function Timeline({ items }: { items: readonly ArtifactTimelineItem[] }) {
  return (
    <AnimatedList className="gap-2">
      {items.map((item, index) => (
        <AnimatedItem key={index} index={index} className="flex items-start gap-2.5">
          <StatusDot status={item.status} className="mt-[7px]" />
          <div className="min-w-0 flex-1">
            <p className="text-ui text-foreground">{item.label}</p>
            {item.description ? (
              <p className="mt-0.5 text-caption text-muted-foreground">{item.description}</p>
            ) : null}
          </div>
          {item.time ? (
            <span className="shrink-0 text-caption text-muted-foreground tabular-nums">
              {item.time}
            </span>
          ) : null}
        </AnimatedItem>
      ))}
    </AnimatedList>
  )
}

const CHANGE_VERB: Record<NonNullable<ArtifactFileChange['action']>, string> = {
  created: 'new',
  updated: 'changed',
  deleted: 'deleted',
  renamed: 'renamed',
  read: 'read',
}

function FileChanges({ items }: { items: readonly ArtifactFileChange[] }) {
  return (
    <AnimatedList className="gap-0.5">
      {items.map((item, index) => (
        <AnimatedItem key={item.path} index={index} className="flex items-center gap-2 py-0.5">
          <Icons.file className="shrink-0" />

          {/* The path truncates from the *left*. A repo path is
              `src/features/chat/transcript/AssistantMessage.tsx`, and the end
              is the part that identifies it — truncating the usual way leaves
              a column of "src/features/chat/tra…" telling you nothing. */}
          <span className="min-w-0 flex-1 truncate text-caption text-foreground [direction:rtl] [text-align:left]">
            {item.path}
          </span>

          {item.action ? (
            <span className="shrink-0 text-micro text-muted-foreground">
              {CHANGE_VERB[item.action]}
            </span>
          ) : null}

          <span className="shrink-0 text-micro tabular-nums">
            {item.additions ? <span className="text-[color:var(--code-string)]">+{item.additions}</span> : null}
            {item.additions && item.deletions ? ' ' : null}
            {item.deletions ? <span className="text-danger">−{item.deletions}</span> : null}
          </span>
        </AnimatedItem>
      ))}
    </AnimatedList>
  )
}

/** The domain, which is what a person recognises in a link. */
export function hostOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '')
  } catch {
    return href
  }
}

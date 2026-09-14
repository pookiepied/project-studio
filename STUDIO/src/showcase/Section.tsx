import type { ReactNode } from 'react'

/** One part of the showcase: a title, one line on what to judge, the specimens. */
export function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-title text-foreground">{title}</h2>
        <p className="text-caption text-muted-foreground">{note}</p>
      </div>
      {children}
    </section>
  )
}

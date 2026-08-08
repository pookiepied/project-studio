import { Workspace } from '@/components/icons'

export default function WorkspacePage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 p-8">
      <Workspace size="xl" className="text-muted-foreground" />
      <h1 className="font-display text-4xl tracking-tight">Workspace</h1>
      <p className="text-sm text-muted-foreground">
        Projects and files land in the workspace slice.
      </p>
    </div>
  )
}

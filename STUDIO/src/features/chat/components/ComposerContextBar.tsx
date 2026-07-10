import { ProjectContextPicker } from "./ProjectContextPicker";

type AccessMode = "review" | "autonomous";
type ProjectCtx = { path: string; name: string; accessMode?: AccessMode };

interface ComposerContextBarProps {
  projectContext: ProjectCtx | null;
  setProjectContext: (ctx: ProjectCtx | null) => void;
  trailing?: React.ReactNode;
}

/**
 * Conversation setup controls shown in a capsule above the composer.
 *
 * Persistent status (branch, environment, context window) lives in ChatHeader —
 * this bar only carries the "what folder is this chat about" action.
 */
export function ComposerContextBar({
  projectContext,
  setProjectContext,
  trailing,
}: ComposerContextBarProps) {
  const widthClass = projectContext
    ? "w-[calc(100%_-_5rem)] max-w-[48rem]"
    : "w-fit max-w-[calc(100%_-_1.5rem)]";

  return (
    <div className={`mx-3 inline-flex ${widthClass} items-center gap-3 self-start rounded-xl border border-surface-border bg-white px-2.5 pb-3 pt-1.5 shadow-sm dark:bg-surface-raised`}>
      <div className="flex min-w-0 items-center gap-1">
        <ProjectContextPicker
          variant="bar"
          projectContext={projectContext}
          setProjectContext={setProjectContext}
        />
      </div>

      {trailing && <div className="flex shrink-0 items-center pl-1">{trailing}</div>}
    </div>
  );
}

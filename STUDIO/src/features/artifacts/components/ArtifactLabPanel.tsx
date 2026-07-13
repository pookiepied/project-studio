import { useMemo, useState } from "react";
import {
  Icon,
  Redo,
  Copy,
  Eye,
  Add,
  Error,
  Conversation,
  BracketsCurlyIcon,
  BroomIcon,
  LayoutIcon,
  StackIcon,
} from "@/ui/icons";
import { ArtifactRenderer } from "@/features/markdown";
import { Button } from "@/ui/primitives/Button";
import { Textarea } from "@/ui/primitives/Textarea";
import { ARTIFACT_EXAMPLES } from "@/features/artifacts/examples";
import type { Artifact, ArtifactSurface } from "@/types/artifacts";
import { artifactToMarkdown, parseArtifact } from "@/lib/artifact";

type ArtifactLabCanvasItem = {
  id: string;
  artifact: Artifact;
};

const SURFACE_LABELS: Record<ArtifactSurface, string> = {
  chat: "Chat",
  overview: "Overview",
  panel: "Panel",
};

function cloneArtifact(artifact: Artifact): Artifact {
  return JSON.parse(JSON.stringify(artifact)) as Artifact;
}

function normalizeEditorValue(artifact: Artifact): string {
  return JSON.stringify(artifact, null, 2);
}

function SurfaceStage({
  artifact,
  index,
}: {
  artifact: Artifact;
  index?: number;
}) {
  const surface = artifact.presentation?.surface ?? "chat";
  const compactLabel = artifact.presentation?.compactLabel;

  if (surface === "overview") {
    return (
      <div className="rounded-2xl border border-surface-border bg-surface-page/80 p-3 shadow-xl dark:border-surface-border dark:bg-surface-base/90">
        <div className="mb-3 rounded-2xl border border-dashed border-surface-border bg-surface-page/80 px-3 py-2 dark:border-surface-divider dark:bg-surface-raised/50">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-disabled dark:text-muted">Overview event</p>
              <p className="mt-1 truncate text-sm font-medium text-secondary dark:text-disabled">
                {compactLabel ?? artifact.title}
              </p>
            </div>
            <span className="rounded-full bg-primary px-2 py-0.5 text-2xs font-medium text-on-emphasis dark:bg-surface-page dark:text-primary">
              #{index ?? 1}
            </span>
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-surface-border dark:border-surface-border">
          <ArtifactRenderer code={JSON.stringify(artifact, null, 2)} />
        </div>
      </div>
    );
  }

  if (surface === "panel") {
    return (
      <div className="rounded-2xl border border-surface-border bg-gradient-to-br from-surface-page via-surface-deep to-surface-base p-4 shadow-xl dark:border-surface-border dark:from-surface-base dark:via-surface-base dark:to-surface-raised">
        <div className="mb-3 flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.14em] text-disabled dark:text-muted">
          <Icon icon={LayoutIcon} size="sm" />
          Panel surface
        </div>
        <div className="overflow-hidden rounded-2xl border border-surface-border dark:border-surface-border">
          <ArtifactRenderer code={JSON.stringify(artifact, null, 2)} />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-surface-border bg-gradient-to-b from-surface-deep to-surface-raised p-4 shadow-xl dark:border-surface-border dark:from-surface-page dark:to-surface-base">
      <div className="mb-4 flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.14em] text-disabled dark:text-muted">
        <Conversation size="sm" />
        Chat surface
      </div>
      <div className="flex justify-start">
        <div className="max-w-[680px] overflow-hidden rounded-2xl border border-surface-border bg-surface-page shadow-lg dark:border-surface-border dark:bg-surface-base">
          <ArtifactRenderer code={JSON.stringify(artifact, null, 2)} />
        </div>
      </div>
    </div>
  );
}

export function ArtifactLabPanel() {
  const [selectedExampleIndex, setSelectedExampleIndex] = useState(0);
  const [editorValue, setEditorValue] = useState(() => normalizeEditorValue(ARTIFACT_EXAMPLES[0]));
  const [canvasItems, setCanvasItems] = useState<ArtifactLabCanvasItem[]>(() =>
    ARTIFACT_EXAMPLES.map((artifact, index) => ({
      id: `seed-${index}`,
      artifact: cloneArtifact(artifact),
    })),
  );

  const parsed = useMemo(() => parseArtifact(editorValue), [editorValue]);
  const activeArtifact = parsed.artifact;

  const loadExample = (index: number) => {
    setSelectedExampleIndex(index);
    setEditorValue(normalizeEditorValue(cloneArtifact(ARTIFACT_EXAMPLES[index])));
  };

  const handleReset = () => {
    loadExample(selectedExampleIndex);
  };

  const handleSpawn = () => {
    if (!activeArtifact) return;
    setCanvasItems((prev) => [
      {
        id: `${Date.now()}-${prev.length}`,
        artifact: cloneArtifact(activeArtifact),
      },
      ...prev,
    ]);
  };

  const handleCopyFence = async () => {
    if (!activeArtifact || typeof navigator === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(artifactToMarkdown(activeArtifact));
  };

  const surfaceBreakdown = useMemo(() => {
    return canvasItems.reduce<Record<ArtifactSurface, number>>(
      (acc, item) => {
        const surface = item.artifact.presentation?.surface ?? "chat";
        acc[surface] += 1;
        return acc;
      },
      { chat: 0, overview: 0, panel: 0 },
    );
  }, [canvasItems]);

  return (
    <div className="grid min-h-full grid-cols-[260px_1.1fr_0.9fr]">
      <aside className="border-r border-surface-border bg-surface-page/45 p-4 dark:border-surface-divider dark:bg-surface-page/[0.015]">
        <div className="mb-4">
          <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-disabled dark:text-muted">Artifact lab</p>
          <h3 className="mt-1 font-display text-xl text-primary dark:text-primary">Universal stage</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted dark:text-disabled">
            Prototype one artifact format, then preview how it lands in different Studio surfaces.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-surface-border bg-surface-page px-3 py-2 dark:border-surface-border dark:bg-surface-base">
            <div className="text-2xs uppercase tracking-[0.12em] text-disabled dark:text-muted">Examples</div>
            <div className="mt-1 text-sm font-medium text-primary dark:text-disabled">{ARTIFACT_EXAMPLES.length}</div>
          </div>
          <div className="rounded-2xl border border-surface-border bg-surface-page px-3 py-2 dark:border-surface-border dark:bg-surface-base">
            <div className="text-2xs uppercase tracking-[0.12em] text-disabled dark:text-muted">Spawned</div>
            <div className="mt-1 text-sm font-medium text-primary dark:text-disabled">{canvasItems.length}</div>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted dark:text-disabled">
            <Icon icon={StackIcon} size="sm" />
            Example library
          </div>
          <div className="space-y-2">
            {ARTIFACT_EXAMPLES.map((artifact, index) => {
              const selected = index === selectedExampleIndex;
              return (
                <Button
                  key={`${artifact.kind}-${index}`}
                  variant="ghost"
                  onClick={() => loadExample(index)}
                  className={`w-full !h-auto flex-col items-stretch !gap-0 !rounded-2xl border px-3 py-3 text-left transition ${
                    selected
                      ? "!border-primary !bg-primary !text-on-emphasis dark:!border-white dark:!bg-surface-page dark:!text-primary"
                      : "!border-surface-border !bg-surface-page hover:!bg-surface-page dark:!border-surface-border dark:!bg-surface-base dark:hover:!bg-surface-raised"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className={`text-2xs font-semibold uppercase tracking-[0.14em] ${selected ? "text-on-emphasis/75 dark:text-muted" : "text-disabled dark:text-muted"}`}>
                      {artifact.category} / {artifact.kind}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-2xs font-medium ${selected ? "bg-surface-page/15 text-on-emphasis dark:bg-primary/10 dark:text-secondary" : "bg-surface-base text-muted dark:bg-surface-raised dark:text-disabled"}`}>
                      {SURFACE_LABELS[artifact.presentation?.surface ?? "chat"]}
                    </span>
                  </div>
                  <div className={`mt-2 text-sm font-medium ${selected ? "text-on-emphasis dark:text-primary" : "text-primary dark:text-disabled"}`}>
                    {artifact.title}
                  </div>
                  <div className={`mt-1 line-clamp-2 text-xs leading-relaxed ${selected ? "text-on-emphasis/75 dark:text-muted" : "text-muted dark:text-disabled"}`}>
                    {artifact.summary}
                  </div>
                </Button>
              );
            })}
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-surface-border bg-surface-page p-3 dark:border-surface-border dark:bg-surface-base">
          <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted dark:text-disabled">
            <Icon icon={LayoutIcon} size="sm" />
            Canvas surfaces
          </div>
          <div className="space-y-2 text-xs text-secondary dark:text-disabled">
            {(["chat", "overview", "panel"] as ArtifactSurface[]).map((surface) => (
              <div key={surface} className="flex items-center justify-between">
                <span>{SURFACE_LABELS[surface]}</span>
                <span className="font-medium text-primary dark:text-disabled">{surfaceBreakdown[surface]}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <main className="min-w-0 overflow-y-auto border-r border-surface-border bg-surface-base p-5 dark:border-surface-divider dark:bg-surface-page">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-disabled dark:text-muted">Preview canvas</p>
            <h3 className="mt-1 font-display text-xl text-primary dark:text-primary">Artifact conversation</h3>
            <p className="mt-1 text-sm text-muted dark:text-disabled">
              Spawn artifacts here to test how a real chat or overview session might feel.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={handleSpawn}
              disabled={!activeArtifact}
              className="inline-flex items-center !gap-1.5 rounded-xl !bg-primary px-3 py-2 text-xs font-medium !text-on-emphasis transition hover:!bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40 dark:!bg-surface-page dark:!text-primary dark:hover:!bg-surface-base"
            >
              <Add size="sm" />
              Spawn artifact
            </Button>
            <Button
              variant="ghost"
              onClick={() => setCanvasItems([])}
              className="inline-flex items-center !gap-1.5 rounded-xl border !border-surface-border !bg-surface-page px-3 py-2 text-xs font-medium !text-secondary transition hover:!bg-surface-page dark:!border-surface-border dark:!bg-surface-base dark:!text-disabled dark:hover:!bg-surface-raised"
            >
              <Icon icon={BroomIcon} size="sm" />
              Clear canvas
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          {canvasItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-surface-border bg-surface-page/70 px-6 py-12 text-center dark:border-surface-divider dark:bg-surface-base/50">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-base dark:bg-surface-raised">
                <Eye size="lg" className="text-disabled dark:text-muted" />
              </div>
              <p className="mt-4 text-sm font-medium text-primary dark:text-disabled">No artifacts on the canvas yet</p>
              <p className="mt-1 text-sm text-muted dark:text-disabled">Load an example or edit the JSON, then spawn it into this stage.</p>
            </div>
          ) : (
            canvasItems.map((item, index) => (
              <SurfaceStage key={item.id} artifact={item.artifact} index={canvasItems.length - index} />
            ))
          )}
        </div>
      </main>

      <aside className="min-w-0 overflow-y-auto bg-surface-page p-5 dark:bg-surface-page">
        <div className="mb-4">
          <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-disabled dark:text-muted">Artifact source</p>
          <h3 className="mt-1 font-display text-xl text-primary dark:text-primary">Universal format editor</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted dark:text-disabled">
            Edit the canonical JSON directly. This is the same artifact envelope the model will eventually emit.
          </p>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            onClick={handleReset}
            className="inline-flex items-center !gap-1.5 rounded-xl border !border-surface-border !bg-surface-page px-3 py-2 text-xs font-medium !text-secondary transition hover:!bg-surface-page dark:!border-surface-border dark:!bg-surface-base dark:!text-disabled dark:hover:!bg-surface-raised"
          >
            <Redo size="sm" />
            Reset example
          </Button>
          <Button
            variant="ghost"
            onClick={handleCopyFence}
            disabled={!activeArtifact}
            className="inline-flex items-center !gap-1.5 rounded-xl border !border-surface-border !bg-surface-page px-3 py-2 text-xs font-medium !text-secondary transition hover:!bg-surface-page disabled:cursor-not-allowed disabled:opacity-40 dark:!border-surface-border dark:!bg-surface-base dark:!text-disabled dark:hover:!bg-surface-raised"
          >
            <Copy size="sm" />
            Copy `artifact` fence
          </Button>
        </div>

        {parsed.error && (
          <div className="mb-3 rounded-2xl border border-surface-border bg-surface-raised px-3 py-2 text-xs text-secondary dark:border-surface-border/40 dark:bg-surface-raised/20 dark:text-secondary">
            <div className="flex items-center gap-2 font-medium">
              <Error size="sm" weight="fill" />
              Artifact validation
            </div>
            <p className="mt-1 leading-relaxed">{parsed.error}</p>
          </div>
        )}

        <label className="block">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted dark:text-disabled">
            <Icon icon={BracketsCurlyIcon} size="sm" />
            JSON payload
          </div>
          <Textarea
            value={editorValue}
            onChange={(event) => setEditorValue(event.target.value)}
            spellCheck={false}
            className="min-h-[430px] resize-y rounded-2xl bg-surface-deep dark:bg-surface-page px-4 py-4 font-mono text-xs leading-6"
          />
        </label>

        {activeArtifact && (
          <div className="mt-5 rounded-2xl border border-surface-border bg-surface-page/70 p-3 dark:border-surface-border dark:bg-surface-base/70">
            <div className="mb-2 text-xs font-medium text-muted dark:text-disabled">Live artifact</div>
            <div className="overflow-hidden rounded-2xl border border-surface-border bg-surface-page dark:border-surface-border dark:bg-surface-base">
              <ArtifactRenderer code={JSON.stringify(activeArtifact, null, 2)} />
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

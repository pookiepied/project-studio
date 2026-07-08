import { useMemo, useState } from "react";
import {
  ArrowClockwiseIcon as ArrowClockwise,
  BracketsCurlyIcon as BracketsCurly,
  BroomIcon as Broom,
  ChatCircleTextIcon as ChatCircleText,
  CopyIcon as Copy,
  EyeIcon as Eye,
  LayoutIcon as Layout,
  PlusIcon as Plus,
  StackIcon as Stack,
  WarningCircleIcon as WarningCircle,
} from "@phosphor-icons/react";
import { ArtifactRenderer } from "@/features/markdown";
import { ARTIFACT_EXAMPLES } from "@/artifacts/examples";
import type { Artifact, ArtifactSurface } from "@/types/artifacts";
import { artifactToMarkdown, parseArtifact } from "@/utils/artifact";

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
      <div className="rounded-2xl border border-gray-200 bg-white/80 p-3 shadow-[0_18px_60px_-34px_rgba(15,23,42,0.28)] dark:border-surface-border dark:bg-surface-base/90">
        <div className="mb-3 rounded-2xl border border-dashed border-gray-200 bg-gray-50/80 px-3 py-2 dark:border-surface-divider dark:bg-surface-raised/50">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">Overview event</p>
              <p className="mt-1 truncate text-sm font-medium text-gray-700 dark:text-gray-300">
                {compactLabel ?? artifact.title}
              </p>
            </div>
            <span className="rounded-full bg-gray-900 px-2 py-0.5 text-2xs font-medium text-white dark:bg-white dark:text-gray-900">
              #{index ?? 1}
            </span>
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-surface-border">
          <ArtifactRenderer code={JSON.stringify(artifact, null, 2)} />
        </div>
      </div>
    );
  }

  if (surface === "panel") {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gradient-to-br from-white via-gray-50 to-gray-100/80 p-4 shadow-[0_24px_70px_-38px_rgba(15,23,42,0.35)] dark:border-surface-border dark:from-surface-base dark:via-surface-base dark:to-surface-raised">
        <div className="mb-3 flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
          <Layout size={12} />
          Panel surface
        </div>
        <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-surface-border">
          <ArtifactRenderer code={JSON.stringify(artifact, null, 2)} />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-gradient-to-b from-surface-deep to-surface-raised p-4 shadow-[0_30px_90px_-44px_rgba(15,23,42,0.35)] dark:border-surface-border dark:from-surface-page dark:to-surface-base">
      <div className="mb-4 flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
        <ChatCircleText size={12} />
        Chat surface
      </div>
      <div className="flex justify-start">
        <div className="max-w-[680px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_16px_40px_-28px_rgba(15,23,42,0.35)] dark:border-surface-border dark:bg-surface-base">
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
      <aside className="border-r border-gray-100 bg-gray-50/45 p-4 dark:border-surface-divider dark:bg-white/[0.015]">
        <div className="mb-4">
          <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500">Artifact lab</p>
          <h3 className="mt-1 font-display text-xl text-gray-900 dark:text-gray-100">Universal stage</h3>
          <p className="mt-2 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            Prototype one artifact format, then preview how it lands in different Studio surfaces.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-gray-200 bg-white px-3 py-2 dark:border-surface-border dark:bg-surface-base">
            <div className="text-2xs uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">Examples</div>
            <div className="mt-1 text-sm font-medium text-gray-800 dark:text-gray-200">{ARTIFACT_EXAMPLES.length}</div>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white px-3 py-2 dark:border-surface-border dark:bg-surface-base">
            <div className="text-2xs uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">Spawned</div>
            <div className="mt-1 text-sm font-medium text-gray-800 dark:text-gray-200">{canvasItems.length}</div>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
            <Stack size={12} />
            Example library
          </div>
          <div className="space-y-2">
            {ARTIFACT_EXAMPLES.map((artifact, index) => {
              const selected = index === selectedExampleIndex;
              return (
                <button
                  key={`${artifact.kind}-${index}`}
                  type="button"
                  onClick={() => loadExample(index)}
                  className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                    selected
                      ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900"
                      : "border-gray-200 bg-white hover:bg-gray-50 dark:border-surface-border dark:bg-surface-base dark:hover:bg-surface-raised"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className={`text-2xs font-semibold uppercase tracking-[0.14em] ${selected ? "text-white/75 dark:text-gray-500" : "text-gray-400 dark:text-gray-500"}`}>
                      {artifact.category} / {artifact.kind}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-2xs font-medium ${selected ? "bg-white/15 text-white dark:bg-gray-900/10 dark:text-gray-700" : "bg-gray-100 text-gray-500 dark:bg-surface-raised dark:text-gray-400"}`}>
                      {SURFACE_LABELS[artifact.presentation?.surface ?? "chat"]}
                    </span>
                  </div>
                  <div className={`mt-2 text-sm font-medium ${selected ? "text-white dark:text-gray-900" : "text-gray-800 dark:text-gray-200"}`}>
                    {artifact.title}
                  </div>
                  <div className={`mt-1 line-clamp-2 text-xs leading-relaxed ${selected ? "text-white/75 dark:text-gray-500" : "text-gray-500 dark:text-gray-400"}`}>
                    {artifact.summary}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-3 dark:border-surface-border dark:bg-surface-base">
          <div className="mb-3 flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
            <Layout size={12} />
            Canvas surfaces
          </div>
          <div className="space-y-2 text-xs text-gray-600 dark:text-gray-400">
            {(["chat", "overview", "panel"] as ArtifactSurface[]).map((surface) => (
              <div key={surface} className="flex items-center justify-between">
                <span>{SURFACE_LABELS[surface]}</span>
                <span className="font-medium text-gray-800 dark:text-gray-200">{surfaceBreakdown[surface]}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <main className="min-w-0 overflow-y-auto border-r border-gray-100 bg-surface-base p-5 dark:border-surface-divider dark:bg-surface-page">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500">Preview canvas</p>
            <h3 className="mt-1 font-display text-xl text-gray-900 dark:text-gray-100">Artifact conversation</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Spawn artifacts here to test how a real chat or overview session might feel.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSpawn}
              disabled={!activeArtifact}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-3 py-2 text-xs font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
            >
              <Plus size={12} weight="bold" />
              Spawn artifact
            </button>
            <button
              type="button"
              onClick={() => setCanvasItems([])}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-surface-border dark:bg-surface-base dark:text-gray-300 dark:hover:bg-surface-raised"
            >
              <Broom size={12} />
              Clear canvas
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {canvasItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white/70 px-6 py-12 text-center dark:border-surface-divider dark:bg-surface-base/50">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 dark:bg-surface-raised">
                <Eye size={18} className="text-gray-400 dark:text-gray-500" />
              </div>
              <p className="mt-4 text-sm font-medium text-gray-800 dark:text-gray-200">No artifacts on the canvas yet</p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Load an example or edit the JSON, then spawn it into this stage.</p>
            </div>
          ) : (
            canvasItems.map((item, index) => (
              <SurfaceStage key={item.id} artifact={item.artifact} index={canvasItems.length - index} />
            ))
          )}
        </div>
      </main>

      <aside className="min-w-0 overflow-y-auto bg-white p-5 dark:bg-surface-page">
        <div className="mb-4">
          <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500">Artifact source</p>
          <h3 className="mt-1 font-display text-xl text-gray-900 dark:text-gray-100">Universal format editor</h3>
          <p className="mt-2 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            Edit the canonical JSON directly. This is the same artifact envelope the model will eventually emit.
          </p>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-surface-border dark:bg-surface-base dark:text-gray-300 dark:hover:bg-surface-raised"
          >
            <ArrowClockwise size={12} />
            Reset example
          </button>
          <button
            type="button"
            onClick={handleCopyFence}
            disabled={!activeArtifact}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-surface-border dark:bg-surface-base dark:text-gray-300 dark:hover:bg-surface-raised"
          >
            <Copy size={12} />
            Copy `artifact` fence
          </button>
        </div>

        {parsed.error && (
          <div className="mb-3 rounded-2xl border border-surface-border bg-surface-raised px-3 py-2 text-xs text-secondary dark:border-surface-border/40 dark:bg-surface-raised/20 dark:text-secondary">
            <div className="flex items-center gap-2 font-medium">
              <WarningCircle size={12} weight="fill" />
              Artifact validation
            </div>
            <p className="mt-1 leading-relaxed">{parsed.error}</p>
          </div>
        )}

        <label className="block">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
            <BracketsCurly size={12} />
            JSON payload
          </div>
          <textarea
            value={editorValue}
            onChange={(event) => setEditorValue(event.target.value)}
            spellCheck={false}
            className="min-h-[430px] w-full resize-y rounded-2xl border border-gray-200 bg-surface-deep px-4 py-4 font-mono text-xs leading-6 text-gray-800 outline-none transition focus:border-gray-900 dark:border-surface-border dark:bg-surface-page dark:text-gray-200 dark:focus:border-gray-200"
          />
        </label>

        {activeArtifact && (
          <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50/70 p-3 dark:border-surface-border dark:bg-surface-base/70">
            <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">Live artifact</div>
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-surface-border dark:bg-surface-base">
              <ArtifactRenderer code={JSON.stringify(activeArtifact, null, 2)} />
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

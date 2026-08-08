import { Document, Files, FolderOpen, Search, Success, Warning } from "@/ui/icons";
import type { Artifact } from "@/types/artifacts";
import { AnimatedItem, AnimatedList, ArtifactIconBubble, ArtifactShell, isArtifactWorking, ProcessingDots } from "./ArtifactMotion";

interface Props {
  artifact: Artifact;
}

type CloudFile = {
  id: string;
  name: string;
  type?: string;
  mimeType?: string;
  owner?: string;
  modifiedAt?: string;
  size?: string;
  path?: string;
  webUrl?: string;
  icon?: "folder" | "document" | "sheet" | "image" | "video" | "file";
  shared?: boolean;
  description?: string;
};

type CloudFileAction = {
  action: "create" | "update" | "move" | "share" | "delete" | "summarize" | "export";
  target?: string;
  result?: string;
};

type CloudFileData = {
  query?: string;
  provider?: string;
  location?: string;
  files?: CloudFile[];
  file?: CloudFile;
  action?: CloudFileAction;
};

function cloudData(artifact: Artifact): CloudFileData {
  if (!artifact.data || typeof artifact.data !== "object") return {};
  return artifact.data as CloudFileData;
}

function providerLabel(artifact: Artifact, data: CloudFileData) {
  const source = (data.provider ?? artifact.source?.app ?? artifact.kind).toLowerCase();
  if (source.includes("onedrive")) return "OneDrive";
  if (source.includes("dropbox")) return "Dropbox";
  if (source.includes("docs")) return "Google Docs";
  if (source.includes("sheets")) return "Google Sheets";
  return "Google Drive";
}

function statusLabel(artifact: Artifact) {
  if (artifact.status === "completed" || artifact.status === "success") return "Completed";
  if (artifact.status === "failed" || artifact.status === "error") return "Failed";
  if (artifact.status === "loading" || artifact.status === "streaming") return "Searching";
  return "Pending";
}

function FileIcon({ file }: { file?: CloudFile }) {
  if (file?.icon === "folder" || file?.type === "folder") return <FolderOpen size="sm" className="text-secondary dark:text-disabled" />;
  if (file?.icon === "document" || file?.mimeType?.includes("document")) return <Document size="sm" className="text-secondary dark:text-disabled" />;
  return <Files size="sm" className="text-secondary dark:text-disabled" />;
}

function Header({ artifact, data, icon, meta }: { artifact: Artifact; data: CloudFileData; icon: React.ReactNode; meta?: string }) {
  const working = isArtifactWorking(artifact.status);
  return (
    <div className="flex items-start gap-3">
      <ArtifactIconBubble working={working}>{icon}</ArtifactIconBubble>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-primary dark:text-primary">{artifact.title}</div>
        <div className="mt-0.5 text-2xs text-disabled dark:text-muted">
          {providerLabel(artifact, data)} / {statusLabel(artifact)}{meta ? ` / ${meta}` : ""}
        </div>
        {artifact.summary && <p className="mt-2 text-sm leading-relaxed text-secondary dark:text-disabled">{artifact.summary}</p>}
      </div>
    </div>
  );
}

function FileRow({ file }: { file: CloudFile }) {
  return (
    <div className="group flex items-start gap-3 rounded-2xl px-1.5 py-2.5 transition-colors hover:bg-surface-page/70 dark:hover:bg-white/[0.04]">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-surface-page dark:bg-white/[0.07]">
        <FileIcon file={file} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <div className="truncate text-sm font-medium text-primary dark:text-primary">{file.name}</div>
          {file.modifiedAt && <div className="flex-shrink-0 text-2xs text-disabled dark:text-muted">{file.modifiedAt}</div>}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted dark:text-disabled">
          {[file.path, file.owner, file.size].filter(Boolean).join(" / ")}
        </div>
        {file.description && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted dark:text-muted">{file.description}</p>}
        {file.shared && <div className="mt-1 text-2xs text-disabled dark:text-muted">Shared</div>}
      </div>
    </div>
  );
}

function CloudFileSearch({ artifact, data }: { artifact: Artifact; data: CloudFileData }) {
  const files = data.files ?? [];
  const working = isArtifactWorking(artifact.status);
  return (
    <ArtifactShell working={working}>
      <Header artifact={artifact} data={data} icon={<Search size="sm" className="text-secondary dark:text-disabled" />} meta={data.location} />
      <div className="mt-3 rounded-2xl bg-surface-page/55 px-3 py-2 text-xs text-muted dark:bg-white/[0.035] dark:text-muted">
        {data.query ? `Search: ${data.query}` : "Browsing files"}
      </div>
      <AnimatedList className="mt-2">
        {files.length > 0 ? (
          files.map((file) => (
            <AnimatedItem key={file.id}>
              <FileRow file={file} />
            </AnimatedItem>
          ))
        ) : (
          <AnimatedItem className="rounded-2xl bg-surface-page/55 px-3 py-5 text-center text-sm text-disabled dark:bg-white/[0.035] dark:text-muted">
            {working ? <>Files will appear here as the connector responds. <ProcessingDots /></> : "No matching files found."}
          </AnimatedItem>
        )}
      </AnimatedList>
      <Footer text={`${files.length} file${files.length === 1 ? "" : "s"}`} />
    </ArtifactShell>
  );
}

function CloudFileDetail({ artifact, data }: { artifact: Artifact; data: CloudFileData }) {
  const file = data.file ?? data.files?.[0];
  return (
    <ArtifactShell working={isArtifactWorking(artifact.status)}>
      <Header artifact={artifact} data={data} icon={<FileIcon file={file} />} meta="File" />
      {file ? (
        <AnimatedItem className="mt-3 rounded-2xl bg-surface-page/55 px-3 py-3 dark:bg-white/[0.035]">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-surface-base dark:bg-white/[0.06]">
              <FileIcon file={file} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-primary dark:text-primary">{file.name}</div>
              <div className="mt-1 text-xs text-muted dark:text-disabled">{[file.type ?? file.mimeType, file.owner, file.modifiedAt].filter(Boolean).join(" / ")}</div>
              {file.path && <div className="mt-0.5 truncate text-xs text-muted dark:text-disabled">{file.path}</div>}
            </div>
          </div>
          {file.description && <p className="mt-3 text-sm leading-relaxed text-secondary dark:text-disabled">{file.description}</p>}
        </AnimatedItem>
      ) : (
        <AnimatedItem className="mt-3 rounded-2xl bg-surface-page/55 px-3 py-5 text-center text-sm text-disabled dark:bg-white/[0.035] dark:text-muted">
          File details will appear here.
        </AnimatedItem>
      )}
      <Footer text="File detail" />
    </ArtifactShell>
  );
}

function CloudFileActionView({ artifact, data }: { artifact: Artifact; data: CloudFileData }) {
  const action = data.action;
  const failed = artifact.status === "failed" || artifact.status === "error" || artifact.status === "rejected";
  return (
    <ArtifactShell working={isArtifactWorking(artifact.status)}>
      <Header
        artifact={artifact}
        data={data}
        icon={failed ? <Warning size="sm" className="text-secondary dark:text-disabled" /> : <Success size="sm" className="text-secondary dark:text-disabled" />}
        meta={action?.action}
      />
      <AnimatedItem className="mt-3 rounded-2xl bg-surface-page/55 px-3 py-3 dark:bg-white/[0.035]">
        <div className="text-sm font-medium text-primary dark:text-primary">{action?.target ?? artifact.title}</div>
        <p className="mt-2 text-sm leading-relaxed text-secondary dark:text-disabled">
          {action?.result ?? artifact.summary ?? "File action is waiting for a result."}
        </p>
      </AnimatedItem>
      <Footer text="File action" />
    </ArtifactShell>
  );
}

function Footer({ text }: { text: string }) {
  return <div className="mt-3 text-2xs text-disabled dark:text-muted">{text} / Studio</div>;
}

export function CloudFileArtifact({ artifact }: Props) {
  const data = cloudData(artifact);
  if (artifact.kind.endsWith("_file")) return <CloudFileDetail artifact={artifact} data={data} />;
  if (artifact.kind.endsWith("_action")) return <CloudFileActionView artifact={artifact} data={data} />;
  return <CloudFileSearch artifact={artifact} data={data} />;
}

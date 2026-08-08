import { Edit, Email, Search, Send, Success, Warning } from "@/ui/icons";
import type { Artifact } from "@/types/artifacts";
import { AnimatedItem, AnimatedList, ArtifactIconBubble, ArtifactShell, isArtifactWorking, ProcessingDots } from "./ArtifactMotion";

interface Props {
  artifact: Artifact;
}

type GmailPerson = {
  name?: string;
  email: string;
};

type GmailMessage = {
  id: string;
  from: GmailPerson;
  to?: GmailPerson[];
  subject: string;
  snippet?: string;
  bodyPreview?: string;
  date?: string;
  labels?: string[];
  attachmentCount?: number;
  unread?: boolean;
};

type GmailDraft = {
  id?: string;
  to: GmailPerson[];
  cc?: GmailPerson[];
  subject: string;
  body: string;
};

type GmailAction = {
  action: "send" | "forward" | "label" | "archive" | "mark_read" | "draft";
  target?: string;
  result?: string;
};

type GmailArtifactData = {
  query?: string;
  mailbox?: string;
  messages?: GmailMessage[];
  message?: GmailMessage;
  thread?: GmailMessage[];
  draft?: GmailDraft;
  action?: GmailAction;
};

function gmailData(artifact: Artifact): GmailArtifactData {
  if (!artifact.data || typeof artifact.data !== "object") return {};
  return artifact.data as GmailArtifactData;
}

function serviceName(artifact: Artifact) {
  return artifact.kind.startsWith("outlook_") || artifact.source?.app === "outlook" ? "Outlook" : "Gmail";
}

function displayPerson(person: GmailPerson) {
  return person.name ? `${person.name} <${person.email}>` : person.email;
}

function initials(person: GmailPerson) {
  const source = person.name || person.email;
  return source
    .split(/[ @._-]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "G";
}

function statusLabel(artifact: Artifact) {
  if (artifact.status === "completed" || artifact.status === "success") return "Completed";
  if (artifact.status === "failed" || artifact.status === "error") return "Failed";
  if (artifact.status === "rejected") return "Rejected";
  if (artifact.status === "loading" || artifact.status === "streaming") return "Working";
  return "Pending";
}

function Header({
  artifact,
  icon,
  meta,
}: {
  artifact: Artifact;
  icon: React.ReactNode;
  meta?: string;
}) {
  const working = isArtifactWorking(artifact.status);
  return (
    <div className="flex items-start gap-3">
      <ArtifactIconBubble working={working}>
        {icon}
      </ArtifactIconBubble>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-primary dark:text-primary">
          {artifact.title}
        </div>
        <div className="mt-0.5 text-2xs text-disabled dark:text-muted">
          {serviceName(artifact)} / {statusLabel(artifact)}{meta ? ` / ${meta}` : ""}
        </div>
        {artifact.summary && (
          <p className="mt-2 text-sm leading-relaxed text-secondary dark:text-disabled">
            {artifact.summary}
          </p>
        )}
      </div>
    </div>
  );
}

function Shell({ children, working = false }: { children: React.ReactNode; working?: boolean }) {
  return <ArtifactShell working={working}>{children}</ArtifactShell>;
}

function PersonAvatar({ person }: { person: GmailPerson }) {
  return (
    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-surface-page text-2xs font-semibold text-secondary dark:bg-white/[0.07] dark:text-disabled">
      {initials(person)}
    </div>
  );
}

function LabelRow({ labels = [] }: { labels?: string[] }) {
  if (!labels.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {labels.map((label) => (
        <span key={label} className="rounded-full bg-surface-page/70 px-2 py-0.5 text-2xs text-muted dark:bg-white/[0.045] dark:text-muted">
          {label}
        </span>
      ))}
    </div>
  );
}

function MessageRow({ message }: { message: GmailMessage }) {
  return (
    <div className="group flex gap-3 rounded-2xl px-1.5 py-2.5 transition-colors hover:bg-surface-page/70 dark:hover:bg-white/[0.04]">
      <PersonAvatar person={message.from} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <div className="truncate text-sm font-medium text-primary dark:text-primary">
            {message.from.name || message.from.email}
          </div>
          {message.date && <div className="flex-shrink-0 text-2xs text-disabled dark:text-muted">{message.date}</div>}
        </div>
        <div className="mt-0.5 truncate text-sm text-secondary dark:text-disabled">
          {message.subject}
        </div>
        {message.snippet && (
          <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted dark:text-muted">
            {message.snippet}
          </div>
        )}
        <div className="mt-1 flex items-center gap-2 text-2xs text-disabled dark:text-muted">
          {message.unread && <span>Unread</span>}
          {message.attachmentCount ? <span>{message.attachmentCount} attachment{message.attachmentCount === 1 ? "" : "s"}</span> : null}
        </div>
        <LabelRow labels={message.labels} />
      </div>
    </div>
  );
}

function GmailSearchArtifact({ artifact, data }: { artifact: Artifact; data: GmailArtifactData }) {
  const messages = data.messages ?? [];
  const working = artifact.status === "loading" || artifact.status === "streaming";

  return (
    <Shell working={working}>
      <Header
        artifact={artifact}
        icon={<Search size="sm" className="text-secondary dark:text-disabled" />}
        meta={data.mailbox ?? "Inbox"}
      />
      <div className="mt-3 rounded-2xl bg-surface-page/55 px-3 py-2 text-xs text-muted dark:bg-white/[0.035] dark:text-muted">
        {data.query ? `Search: ${data.query}` : `Searching ${serviceName(artifact)}`}
      </div>
      <AnimatedList className="mt-2">
        {messages.length > 0 ? (
          messages.map((message) => (
            <AnimatedItem key={message.id}>
              <MessageRow message={message} />
            </AnimatedItem>
          ))
        ) : (
          <AnimatedItem className="rounded-2xl bg-surface-page/55 px-3 py-5 text-center text-sm text-disabled dark:bg-white/[0.035] dark:text-muted">
            {working ? <>Matching emails will appear here as {serviceName(artifact)} responds. <ProcessingDots /></> : "No matching emails found."}
          </AnimatedItem>
        )}
      </AnimatedList>
      <Footer text={`${messages.length} result${messages.length === 1 ? "" : "s"}`} />
    </Shell>
  );
}

function GmailMessageArtifact({ artifact, data }: { artifact: Artifact; data: GmailArtifactData }) {
  const message = data.message ?? data.thread?.[0];
  const thread = data.thread ?? (message ? [message] : []);

  return (
    <Shell working={isArtifactWorking(artifact.status)}>
      <Header
        artifact={artifact}
        icon={<Email size="sm" className="text-secondary dark:text-disabled" />}
        meta={thread.length > 1 ? `${thread.length} messages` : "Message"}
      />
      {message ? (
        <div className="mt-3 space-y-3">
          <div className="flex gap-3">
            <PersonAvatar person={message.from} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-primary dark:text-primary">{message.subject}</div>
              <div className="mt-1 text-xs text-muted dark:text-disabled">
                From {displayPerson(message.from)}
              </div>
              {message.to?.length ? (
                <div className="mt-0.5 text-xs text-muted dark:text-disabled">
                  To {message.to.map(displayPerson).join(", ")}
                </div>
              ) : null}
              <LabelRow labels={message.labels} />
            </div>
          </div>
          <AnimatedList className="space-y-3">
          {thread.map((item) => (
            <AnimatedItem key={item.id} className="rounded-2xl bg-surface-page/55 px-3 py-3 dark:bg-white/[0.035]">
              <div className="flex items-center justify-between gap-3">
                <div className="truncate text-xs font-medium text-secondary dark:text-disabled">
                  {item.from.name || item.from.email}
                </div>
                {item.date && <div className="flex-shrink-0 text-2xs text-disabled dark:text-muted">{item.date}</div>}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-secondary dark:text-disabled">
                {item.bodyPreview ?? item.snippet ?? "No preview available."}
              </p>
            </AnimatedItem>
          ))}
          </AnimatedList>
        </div>
      ) : (
        <div className="mt-3 rounded-2xl bg-surface-page/55 px-3 py-5 text-center text-sm text-disabled dark:bg-white/[0.035] dark:text-muted">
          Email details will appear here.
        </div>
      )}
      <Footer text={`${serviceName(artifact)} message`} />
    </Shell>
  );
}

function GmailDraftArtifact({ artifact, data }: { artifact: Artifact; data: GmailArtifactData }) {
  const draft = data.draft;

  return (
    <Shell working={isArtifactWorking(artifact.status)}>
      <Header
        artifact={artifact}
        icon={<Edit size="sm" className="text-secondary dark:text-disabled" />}
        meta={artifact.status === "completed" ? "Sent" : "Draft"}
      />
      {draft ? (
        <AnimatedItem className="mt-3 rounded-2xl bg-surface-page/55 px-3 py-3 dark:bg-white/[0.035]">
          <div className="space-y-1.5 text-xs text-muted dark:text-disabled">
            <div><span className="text-disabled dark:text-muted">To </span>{draft.to.map(displayPerson).join(", ")}</div>
            {draft.cc?.length ? <div><span className="text-disabled dark:text-muted">Cc </span>{draft.cc.map(displayPerson).join(", ")}</div> : null}
            <div><span className="text-disabled dark:text-muted">Subject </span>{draft.subject}</div>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-secondary dark:text-disabled">
            {draft.body}
          </p>
        </AnimatedItem>
      ) : (
        <div className="mt-3 rounded-2xl bg-surface-page/55 px-3 py-5 text-center text-sm text-disabled dark:bg-white/[0.035] dark:text-muted">
          Draft content will appear here.
        </div>
      )}
      <AnimatedList className="mt-3 flex flex-wrap gap-2">
        <span className="rounded-full bg-surface-page/70 px-2.5 py-1 text-xs font-medium text-secondary dark:bg-white/[0.045] dark:text-disabled">
          Review before sending
        </span>
        <span className="rounded-full bg-surface-page/70 px-2.5 py-1 text-xs font-medium text-secondary dark:bg-white/[0.045] dark:text-disabled">
          Editable draft
        </span>
      </AnimatedList>
      <Footer text={`${serviceName(artifact)} draft`} />
    </Shell>
  );
}

function GmailActionArtifact({ artifact, data }: { artifact: Artifact; data: GmailArtifactData }) {
  const action = data.action;
  const success = artifact.status === "completed" || artifact.status === "success";
  const failed = artifact.status === "failed" || artifact.status === "error" || artifact.status === "rejected";

  return (
    <Shell working={isArtifactWorking(artifact.status)}>
      <Header
        artifact={artifact}
        icon={
          success ? (
            <Success size="sm" className="text-secondary dark:text-disabled" />
          ) : failed ? (
            <Warning size="sm" className="text-secondary dark:text-disabled" />
          ) : (
            <Send size="sm" className="text-secondary dark:text-disabled" />
          )
        }
        meta={action?.action ? action.action.split("_").join(" ") : "Action"}
      />
      <AnimatedItem className="mt-3 rounded-2xl bg-surface-page/55 px-3 py-3 dark:bg-white/[0.035]">
        <div className="text-sm font-medium text-primary dark:text-primary">
          {action?.target ?? artifact.title}
        </div>
        <p className="mt-2 text-sm leading-relaxed text-secondary dark:text-disabled">
          {action?.result ?? artifact.summary ?? `${serviceName(artifact)} action is waiting for a result.`}
        </p>
      </AnimatedItem>
      <Footer text={`${serviceName(artifact)} action`} />
    </Shell>
  );
}

function Footer({ text }: { text: string }) {
  return <div className="mt-3 text-2xs text-disabled dark:text-muted">{text} / Studio</div>;
}

export function GmailArtifact({ artifact }: Props) {
  const data = gmailData(artifact);

  if (artifact.kind === "gmail_search" || artifact.kind === "outlook_search") return <GmailSearchArtifact artifact={artifact} data={data} />;
  if (artifact.kind === "gmail_message" || artifact.kind === "gmail_thread" || artifact.kind === "outlook_message" || artifact.kind === "outlook_thread") return <GmailMessageArtifact artifact={artifact} data={data} />;
  if (artifact.kind === "gmail_draft" || artifact.kind === "outlook_draft") return <GmailDraftArtifact artifact={artifact} data={data} />;
  return <GmailActionArtifact artifact={artifact} data={data} />;
}

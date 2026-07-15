import { Calendar, Clock, Edit, Search, Success, Warning } from "@/ui/icons";
import type { Artifact } from "@/types/artifacts";
import { AnimatedItem, AnimatedList, ArtifactIconBubble, ArtifactShell, isArtifactWorking, ProcessingDots } from "./ArtifactMotion";

interface Props {
  artifact: Artifact;
}

type CalendarAttendee = {
  name?: string;
  email: string;
  status?: "accepted" | "declined" | "tentative" | "needs_action";
};

type CalendarEvent = {
  id: string;
  title: string;
  date: string;
  time: string;
  calendar?: string;
  location?: string;
  meetLink?: string;
  organizer?: CalendarAttendee;
  attendees?: CalendarAttendee[];
  description?: string;
  status?: "confirmed" | "tentative" | "cancelled";
};

type CalendarSlot = {
  id: string;
  date: string;
  time: string;
  score?: string;
  conflict?: string;
};

type CalendarDraft = {
  title: string;
  date: string;
  time: string;
  duration?: string;
  location?: string;
  attendees?: CalendarAttendee[];
  description?: string;
};

type CalendarAction = {
  action: "create" | "update" | "delete" | "respond" | "reschedule";
  target?: string;
  result?: string;
};

type CalendarArtifactData = {
  query?: string;
  timezone?: string;
  events?: CalendarEvent[];
  event?: CalendarEvent;
  draft?: CalendarDraft;
  action?: CalendarAction;
  slots?: CalendarSlot[];
  conflicts?: CalendarEvent[];
};

function calendarData(artifact: Artifact): CalendarArtifactData {
  if (!artifact.data || typeof artifact.data !== "object") return {};
  return artifact.data as CalendarArtifactData;
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
      <ArtifactIconBubble working={working}>{icon}</ArtifactIconBubble>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-primary dark:text-primary">
          {artifact.title}
        </div>
        <div className="mt-0.5 text-2xs text-disabled dark:text-muted">
          Calendar / {statusLabel(artifact)}{meta ? ` / ${meta}` : ""}
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

function CalendarTopBar({
  title,
  meta,
}: {
  title: string;
  meta?: string;
}) {
  return (
    <div className="mt-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-primary dark:text-primary">{title}</div>
        {meta && <div className="mt-0.5 text-2xs text-muted dark:text-muted">{meta}</div>}
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[9px] text-disabled/80 dark:text-muted">
        {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
          <span key={`${day}-${index}`} className={`flex h-4 w-4 items-center justify-center rounded-full ${index === 3 ? "bg-surface-base text-secondary dark:bg-white/[0.07] dark:text-disabled" : ""}`}>{day}</span>
        ))}
      </div>
    </div>
  );
}

function person(attendee: CalendarAttendee) {
  return attendee.name ? `${attendee.name} <${attendee.email}>` : attendee.email;
}

function AttendeePills({ attendees = [] }: { attendees?: CalendarAttendee[] }) {
  if (!attendees.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {attendees.map((attendee) => (
        <span key={attendee.email} className="rounded-full bg-surface-page/70 px-2 py-0.5 text-2xs text-muted dark:bg-white/[0.045] dark:text-muted">
          {attendee.name ?? attendee.email}{attendee.status ? ` / ${attendee.status.replace("_", " ")}` : ""}
        </span>
      ))}
    </div>
  );
}

function DateTile({ date, time }: { date: string; time: string }) {
  const [month, day] = date.split(" ");
  const firstTime = time.split(" ")[0];
  return (
    <div className="flex w-12 flex-shrink-0 flex-col items-center pt-0.5 text-center">
      <div className="text-[9px] font-medium uppercase tracking-[0.1em] text-muted/80 dark:text-muted">
        {month ?? date}
      </div>
      <div className="mt-1 font-display text-xl leading-none text-primary dark:text-primary">{day ?? ""}</div>
      <div className="mt-1 text-[9px] text-disabled dark:text-muted">{firstTime}</div>
    </div>
  );
}

function EventRow({ event }: { event: CalendarEvent }) {
  return (
    <div className="group flex items-start gap-3 py-3">
      <DateTile date={event.date} time={event.time} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-primary dark:text-primary">{event.title}</div>
            <div className="mt-0.5 text-xs text-muted dark:text-disabled">
              {event.time}{event.location ? ` / ${event.location}` : ""}
            </div>
          </div>
          {event.status && (
            <span className="rounded-full bg-surface-base/60 px-2 py-0.5 text-2xs text-muted dark:bg-white/[0.04]">
              {event.status}
            </span>
          )}
        </div>
        {event.description && <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted dark:text-muted">{event.description}</p>}
        <AttendeePills attendees={event.attendees} />
      </div>
    </div>
  );
}

function CalendarListArtifact({ artifact, data }: { artifact: Artifact; data: CalendarArtifactData }) {
  const events = data.events ?? [];
  const working = isArtifactWorking(artifact.status);

  return (
    <ArtifactShell working={working}>
      <Header artifact={artifact} icon={<Search size="sm" className="text-secondary dark:text-disabled" />} meta={data.timezone} />
      <CalendarTopBar title={artifact.kind === "calendar_schedule" ? "Agenda" : "Calendar results"} meta={data.query ? `Search: ${data.query}` : data.timezone} />
      <AnimatedList className="mt-2">
        {events.length > 0 ? (
          events.map((event, index) => (
            <AnimatedItem key={event.id} className={index > 0 ? "border-t border-surface-border/45 dark:border-white/[0.055]" : ""}>
              <EventRow event={event} />
            </AnimatedItem>
          ))
        ) : (
          <AnimatedItem className="py-6 text-center text-sm text-disabled dark:text-muted">
            {working ? <>Calendar results will appear here. <ProcessingDots /></> : "No calendar events found."}
          </AnimatedItem>
        )}
      </AnimatedList>
      <Footer text={`${events.length} event${events.length === 1 ? "" : "s"}`} />
    </ArtifactShell>
  );
}

function CalendarEventArtifact({ artifact, data }: { artifact: Artifact; data: CalendarArtifactData }) {
  const event = data.event ?? data.events?.[0];
  return (
    <ArtifactShell working={isArtifactWorking(artifact.status)}>
      <Header artifact={artifact} icon={<Calendar size="sm" className="text-secondary dark:text-disabled" />} meta="Event" />
      {event ? (
        <AnimatedItem className="mt-4">
          <div className="flex items-start gap-4">
            <div className="flex w-16 flex-shrink-0 flex-col items-center pt-0.5 text-primary dark:text-primary">
              <span className="text-2xs uppercase tracking-[0.12em] text-muted dark:text-muted">{event.date.split(" ")[0]}</span>
              <span className="mt-1 font-display text-3xl leading-none">{event.date.split(" ")[1]}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-base font-medium text-primary dark:text-primary">{event.title}</div>
              <div className="mt-1 text-sm text-secondary dark:text-disabled">{event.time}</div>
              {event.location && <div className="mt-0.5 text-xs text-muted dark:text-disabled">{event.location}</div>}
              {event.meetLink && <div className="mt-0.5 truncate text-xs text-muted dark:text-disabled">{event.meetLink}</div>}
              {event.organizer && <div className="mt-3 text-xs text-muted dark:text-disabled">Organizer: {person(event.organizer)}</div>}
              <AttendeePills attendees={event.attendees} />
            </div>
          </div>
          {event.description && (
            <div className="mt-4 border-t border-surface-border/45 pt-3 text-sm leading-relaxed text-secondary dark:border-white/[0.055] dark:text-disabled">
              {event.description}
            </div>
          )}
        </AnimatedItem>
      ) : (
        <AnimatedItem className="mt-3 py-5 text-center text-sm text-disabled dark:text-muted">
          Event details will appear here.
        </AnimatedItem>
      )}
      <Footer text="Calendar event" />
    </ArtifactShell>
  );
}

function CalendarDraftArtifact({ artifact, data }: { artifact: Artifact; data: CalendarArtifactData }) {
  const draft = data.draft;
  return (
    <ArtifactShell working={isArtifactWorking(artifact.status)}>
      <Header artifact={artifact} icon={<Edit size="sm" className="text-secondary dark:text-disabled" />} meta="Draft" />
      {draft ? (
        <AnimatedItem className="mt-4">
          <div className="flex gap-3">
            <DateTile date={draft.date} time={draft.time} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-primary dark:text-primary">{draft.title}</div>
              <div className="mt-1 text-xs text-muted dark:text-disabled">{draft.time}{draft.duration ? ` / ${draft.duration}` : ""}</div>
              {draft.location && <div className="mt-0.5 text-xs text-muted dark:text-disabled">{draft.location}</div>}
              <AttendeePills attendees={draft.attendees} />
            </div>
          </div>
          {draft.description && <p className="mt-3 text-sm leading-relaxed text-secondary dark:text-disabled">{draft.description}</p>}
        </AnimatedItem>
      ) : (
        <AnimatedItem className="mt-3 py-5 text-center text-sm text-disabled dark:text-muted">
          Event draft will appear here.
        </AnimatedItem>
      )}
      <Footer text="Calendar draft" />
    </ArtifactShell>
  );
}

function CalendarActionArtifact({ artifact, data }: { artifact: Artifact; data: CalendarArtifactData }) {
  const action = data.action;
  const failed = artifact.status === "failed" || artifact.status === "error" || artifact.status === "rejected";
  return (
    <ArtifactShell working={isArtifactWorking(artifact.status)}>
      <Header
        artifact={artifact}
        icon={failed ? <Warning size="sm" className="text-secondary dark:text-disabled" /> : <Success size="sm" className="text-secondary dark:text-disabled" />}
        meta={action?.action ?? "Action"}
      />
      <AnimatedItem className="mt-4">
        <div className="text-sm font-medium text-primary dark:text-primary">{action?.target ?? artifact.title}</div>
        <p className="mt-2 text-sm leading-relaxed text-secondary dark:text-disabled">
          {action?.result ?? artifact.summary ?? "Calendar action is waiting for a result."}
        </p>
      </AnimatedItem>
      <Footer text="Calendar action" />
    </ArtifactShell>
  );
}

function CalendarAvailabilityArtifact({ artifact, data }: { artifact: Artifact; data: CalendarArtifactData }) {
  const slots = data.slots ?? [];
  const conflicts = data.conflicts ?? [];
  return (
    <ArtifactShell working={isArtifactWorking(artifact.status)}>
      <Header artifact={artifact} icon={<Clock size="sm" className="text-secondary dark:text-disabled" />} meta={data.timezone} />
      {conflicts.length > 0 && (
        <AnimatedList className="mt-4 space-y-2">
          {conflicts.map((event) => (
            <AnimatedItem key={event.id}>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-muted/45 dark:bg-white/20" />
                <div className="text-xs font-medium text-secondary dark:text-disabled">Conflict: {event.title}</div>
              </div>
              <div className="mt-0.5 pl-4 text-2xs text-muted dark:text-muted">{event.date} / {event.time}</div>
            </AnimatedItem>
          ))}
        </AnimatedList>
      )}
      <AnimatedList className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {slots.map((slot) => (
          <AnimatedItem key={slot.id} className="border-l border-surface-border/60 pl-3 dark:border-white/[0.08]">
            {slot.score && <span className="text-2xs font-medium text-muted dark:text-muted">{slot.score}</span>}
            <div className="mt-2 text-sm font-medium text-primary dark:text-primary">{slot.date}</div>
            <div className="mt-0.5 text-xs text-muted dark:text-disabled">{slot.time}</div>
            {slot.conflict && <p className="mt-1 text-xs text-muted dark:text-muted">{slot.conflict}</p>}
          </AnimatedItem>
        ))}
      </AnimatedList>
      <Footer text={`${slots.length} suggested slot${slots.length === 1 ? "" : "s"}`} />
    </ArtifactShell>
  );
}

function Footer({ text }: { text: string }) {
  return <div className="mt-3 text-2xs text-disabled dark:text-muted">{text} / Studio</div>;
}

export function CalendarArtifact({ artifact }: Props) {
  const data = calendarData(artifact);
  if (artifact.kind === "calendar_list" || artifact.kind === "calendar_search" || artifact.kind === "calendar_schedule") {
    return <CalendarListArtifact artifact={artifact} data={data} />;
  }
  if (artifact.kind === "calendar_event") return <CalendarEventArtifact artifact={artifact} data={data} />;
  if (artifact.kind === "calendar_draft") return <CalendarDraftArtifact artifact={artifact} data={data} />;
  if (artifact.kind === "calendar_availability") return <CalendarAvailabilityArtifact artifact={artifact} data={data} />;
  return <CalendarActionArtifact artifact={artifact} data={data} />;
}

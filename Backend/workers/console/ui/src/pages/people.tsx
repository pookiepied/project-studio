import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { UserPlus } from "lucide-react";
import type { Role, User } from "@pookiepied/core/contracts";
import { api, type SessionRow } from "../lib/api";
import { relative } from "../lib/format";
import { useLive } from "../lib/useLive";
import { cn } from "../lib/cn";
import {
  Appear,
  Button,
  Card,
  Chip,
  Confirm,
  Empty,
  Input,
  List,
  Section,
  Select,
} from "../components/ui";

/**
 * Status is carried by a word, not a colour.
 *
 * `invited` and `disabled` are both perfectly normal states — one is an
 * allowlist entry that has not logged in yet, the other is a revoked account.
 * Neither is a fault, so neither gets the danger hue that the health page
 * reserves for a service being down.
 */
function Status({ status }: { status: User["status"] }) {
  return (
    <span
      className={cn(
        "text-caption",
        status === "active" ? "text-muted-foreground" : "text-foreground",
      )}
    >
      {status}
    </span>
  );
}

function Sessions({ userId }: { userId: string }) {
  const live = useLive(() => api.sessions(userId), null, [userId]);
  const [busy, setBusy] = useState<string | null>(null);

  const revoke = async (id: string) => {
    setBusy(id);
    try {
      await api.revokeSession(id);
      live.refresh();
    } finally {
      setBusy(null);
    }
  };

  const rows = (live.data?.sessions ?? []) as SessionRow[];
  const active = rows.filter((s) => !s.revoked_at && s.expires_at > Date.now());

  if (live.loading) return <Empty>Loading sessions…</Empty>;
  if (active.length === 0) return <Empty>No live sessions.</Empty>;

  return (
    <List className="bg-surface-sunken">
      {active.map((s) => (
        <div key={s.id} className="flex items-center gap-3 px-3 py-2">
          <span className="text-caption flex-1 truncate text-muted-foreground">
            {s.ip ?? "unknown ip"} · {s.ua?.slice(0, 48) ?? "unknown client"}
          </span>
          <span className="text-caption flex-none text-muted-foreground">
            {relative(s.created_at)}
          </span>
          <Confirm
            label="revoke"
            confirm="revoke?"
            disabled={busy === s.id}
            onConfirm={() => revoke(s.id)}
          />
        </div>
      ))}
    </List>
  );
}

function Person({ user, onChanged }: { user: User; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3 px-3 py-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-ui min-w-0 flex-1 truncate text-left transition-colors duration-fast hover:text-muted-foreground"
        >
          {user.email}
        </button>
        <span className="text-caption w-12 flex-none text-muted-foreground">{user.role}</span>
        <span className="w-16 flex-none">
          <Status status={user.status} />
        </span>
        {/* Enabling is reversible and adds access; disabling revokes every live
            session in the same statement, so only one of the two asks twice. */}
        {user.status === "disabled" ? (
          <Button disabled={busy} onClick={() => act(() => api.setStatus(user.id, "active"))}>
            enable
          </Button>
        ) : (
          <Confirm
            label="disable"
            confirm="disable?"
            disabled={busy}
            onConfirm={() => act(() => api.setStatus(user.id, "disabled"))}
          />
        )}
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 px-3 pb-2">
              <span className="text-caption text-muted-foreground">role</span>
              {(["user", "admin"] as Role[]).map((r) => (
                <Chip
                  key={r}
                  active={user.role === r}
                  disabled={busy || user.role === r}
                  onClick={() => act(() => api.setRole(user.id, r))}
                >
                  {r}
                </Chip>
              ))}
            </div>
            <Sessions userId={user.id} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function PeoplePage() {
  const users = useLive(() => api.users(), null, []);
  const audit = useLive(() => api.audit(), 60_000, []);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invite = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.invite(email.trim(), role);
      setEmail("");
      users.refresh();
      audit.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Appear className="flex flex-col gap-6">
      <Section title="Invite">
        <Card className="p-3">
          <form onSubmit={invite} className="flex flex-wrap items-center gap-2">
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="min-w-56 flex-1"
            />
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="user">user</option>
              <option value="admin">admin</option>
            </Select>
            <Button type="submit" variant="solid" disabled={busy}>
              <UserPlus className="mark text-primary-foreground" strokeWidth={1.75} />
              invite
            </Button>
          </form>
          {error ? <p className="text-caption mt-2 text-danger">{error}</p> : null}
          <p className="text-caption mt-2 text-muted-foreground">
            There is no signup. An address only becomes an account here, and stays{" "}
            <span className="text-foreground">invited</span> until its first login.
          </p>
        </Card>
      </Section>

      <Section title={`People · ${users.data?.users.length ?? 0}`}>
        <Card className="overflow-hidden">
          {users.loading ? (
            <Empty>Loading…</Empty>
          ) : (users.data?.users ?? []).length === 0 ? (
            <Empty>Nobody yet.</Empty>
          ) : (
            <List>
              {(users.data?.users ?? []).map((u) => (
                <Person key={u.id} user={u} onChanged={() => { users.refresh(); audit.refresh(); }} />
              ))}
            </List>
          )}
        </Card>
      </Section>

      <Section title="Audit">
        <Card className="overflow-hidden">
          {(audit.data?.events ?? []).length === 0 ? (
            <Empty>No recorded actions.</Empty>
          ) : (
            <List>
              {(audit.data?.events ?? []).slice(0, 25).map((e) => (
                <div key={e.id} className="flex items-center gap-3 px-3 py-1.5">
                  <span className="text-caption w-40 flex-none truncate">{e.action}</span>
                  <span className="text-mono min-w-0 flex-1 truncate text-muted-foreground">
                    {e.target ?? "—"}
                  </span>
                  <span className="text-caption flex-none text-muted-foreground">
                    {relative(e.created_at)}
                  </span>
                </div>
              ))}
            </List>
          )}
        </Card>
      </Section>
    </Appear>
  );
}

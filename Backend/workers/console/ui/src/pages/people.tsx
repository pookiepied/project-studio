import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { UserPlus } from "lucide-react";
import type { Role, User } from "@pookiepied/core/contracts";
import { api, type SessionRow } from "../lib/api";
import { relative } from "../lib/format";
import { useLive } from "../lib/useLive";
import { cn } from "../lib/cn";
import { Appear, Button, Chip, Confirm, Empty, List } from "../components/ui";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "../components/primitives/Panel";
import { Field } from "../components/primitives/Field";
import { Menu, MenuItem } from "../components/primitives/Menu";
import { COLLAPSE } from "../design/tokens";

/**
 * The words shown for a role, separate from the values stored for one.
 *
 * `role` is a database column and stays lowercase everywhere it is a value —
 * in the URL, in the audit log, in D1. What a person reads is a label, and a
 * label is a sentence fragment, so it is capitalised. Conflating the two is how
 * an interface ends up shouting `disabled` at someone in a table cell.
 */
const ROLE_LABEL: Record<Role, string> = { user: "User", admin: "Admin" };

const STATUS_LABEL: Record<User["status"], string> = {
  invited: "Invited",
  active: "Active",
  disabled: "Disabled",
};

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
      {STATUS_LABEL[status]}
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
            label="Revoke"
            confirm="Confirm?"
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
      <div className="flex items-center gap-3 px-6 py-2.5">
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-ui min-w-0 flex-1 truncate text-left transition-colors duration-fast hover:text-muted-foreground"
        >
          {user.email}
        </button>
        <span className="text-caption w-14 flex-none text-muted-foreground">
          {ROLE_LABEL[user.role]}
        </span>
        <span className="w-16 flex-none">
          <Status status={user.status} />
        </span>
        {/* Enabling is reversible and adds access; disabling revokes every live
            session in the same statement, so only one of the two asks twice. */}
        {user.status === "disabled" ? (
          <Button disabled={busy} onClick={() => act(() => api.setStatus(user.id, "active"))}>
            Enable
          </Button>
        ) : (
          <Confirm
            label="Disable"
            confirm="Confirm?"
            disabled={busy}
            onConfirm={() => act(() => api.setStatus(user.id, "disabled"))}
          />
        )}
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            {...COLLAPSE}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 px-6 pb-3">
              <span className="text-caption text-muted-foreground">Role</span>
              {(["user", "admin"] as Role[]).map((r) => (
                <Chip
                  key={r}
                  active={user.role === r}
                  disabled={busy || user.role === r}
                  onClick={() => act(() => api.setRole(user.id, r))}
                >
                  {ROLE_LABEL[r]}
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
    <Appear className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      <Panel className="xl:col-span-2">
        <PanelHeader title="Invite" />
        <PanelBody>
          <form onSubmit={invite} className="flex flex-wrap items-center gap-2">
            <Field
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              aria-label="Email address to invite"
              className="min-w-56 flex-1"
            />
            <Menu
              ariaLabel={`Role: ${ROLE_LABEL[role]}`}
              trigger={<span>{ROLE_LABEL[role]}</span>}
            >
              {(close) =>
                (["user", "admin"] as Role[]).map((r) => (
                  <MenuItem
                    key={r}
                    selected={role === r}
                    onSelect={() => {
                      setRole(r);
                      close();
                    }}
                  >
                    {ROLE_LABEL[r]}
                  </MenuItem>
                ))
              }
            </Menu>
            <Button type="submit" variant="solid" disabled={busy}>
              <UserPlus className="mark text-primary-foreground" strokeWidth={1.75} />
              Invite
            </Button>
          </form>
          {error ? <p className="text-caption mt-2 text-danger">{error}</p> : null}
          <p className="text-caption mt-2 text-muted-foreground">
            There is no signup. An address only becomes an account here, and stays{" "}
            <span className="text-foreground">invited</span> until its first login.
          </p>
        </PanelBody>
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHeader title="People" actions={
          <span className="text-caption tnum pr-1 text-muted-foreground">
            {users.data?.users.length ?? 0}
          </span>
        } />
        <div className="mt-3 border-t border-hairline">
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
        </div>
        <PanelFooter
          legend={[
            { label: "Active", status: "ok" },
            { label: "Invited or disabled", status: "degraded" },
          ]}
          total={`Admins: ${(users.data?.users ?? []).filter((u) => u.role === "admin").length}`}
        />
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHeader title="Audit" />
        <div className="mt-3 border-t border-hairline">
          {(audit.data?.events ?? []).length === 0 ? (
            <Empty>No recorded actions.</Empty>
          ) : (
            <List>
              {(audit.data?.events ?? []).slice(0, 25).map((e) => (
                <div key={e.id} className="flex items-center gap-3 px-6 py-2">
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
        </div>
      </Panel>
    </Appear>
  );
}

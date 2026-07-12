import {
  PlusIcon as Plus,
  UserCircleIcon as UserCircle,
} from "@phosphor-icons/react";
import { motion, AnimatePresence } from "framer-motion";
import { Back, Refresh, Delete, Success, Warning, Icon } from "@/ui/icons";
import { Input } from "@/ui/primitives/Input";
import { Button } from "@/ui/primitives/Button";
import { Badge } from "@/ui/primitives/Badge";
import { IconButton } from "@/ui/primitives/IconButton";
import { EmptyState } from "@/ui/primitives/EmptyState";
import { Spinner } from "@/ui/primitives/Spinner";
import type { WhitelistedUser, FetchState, ActionState } from "../types";
import { Avatar } from "./Avatar";
import { fmtRelative } from "../helpers";

interface Props {
  wlState: FetchState;
  users: WhitelistedUser[];
  currentUserEmail: string | undefined;
  isRefreshing: boolean;
  addEmail: string;
  setAddEmail: (v: string) => void;
  addState: ActionState;
  addError: string | null;
  setAddError: (e: string | null) => void;
  removingEmail: string | null;
  removeError: string | null;
  onBack: () => void;
  onRefresh: () => void;
  onAdd: () => void;
  onRemove: (email: string) => void;
  onRetry: () => void;
}

export const WhitelistView = ({
  wlState, users, currentUserEmail, isRefreshing,
  addEmail, setAddEmail, addState, addError, setAddError,
  removingEmail, removeError,
  onBack, onRefresh, onAdd, onRemove, onRetry,
}: Props) => (
  <motion.div
    key="whitelist"
    className="h-full flex flex-col"
    initial={{ opacity: 0, x: 12 }}
    animate={{ opacity: 1, x: 0 }}
    exit={{ opacity: 0, x: 12 }}
    transition={{ duration: 0.15, ease: "easeOut" }}
  >
    <div className="flex-shrink-0 px-4 py-3 border-b border-surface-border flex items-center gap-2">
      <IconButton variant="ghost" size="sm" aria-label="Back to Manage" onClick={onBack}>
        <Back size="sm" />
      </IconButton>
      <span className="text-sm font-semibold text-primary font-sans">Whitelist</span>
      {wlState === "ready" && (
        <Badge tone="default" size="sm">{users.length}</Badge>
      )}
      <IconButton
        variant="ghost"
        size="sm"
        aria-label="Refresh whitelist"
        onClick={onRefresh}
        disabled={isRefreshing || wlState === "loading"}
        className="ml-auto"
      >
        <Refresh size="xs" className={isRefreshing ? "animate-spin" : ""} />
      </IconButton>
    </div>

    {wlState === "loading" && (
      <div className="flex-1 flex items-center justify-center">
        <Spinner size="lg" className="text-muted" />
      </div>
    )}

    {wlState === "error" && (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <Warning size="md" weight="fill" className="mx-auto text-primary" />
          <p className="text-xs text-secondary">Failed to load.</p>
          <Button
            variant="ghost"
            onClick={onRetry}
            className="text-xs text-muted underline h-auto px-0 py-0 hover:bg-transparent hover:text-primary"
          >
            Try again
          </Button>
        </div>
      </div>
    )}

    {wlState === "ready" && (
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-4 pb-4">
          <div className="flex items-center gap-2 max-w-xs">
            <Input
              type="email"
              size="sm"
              value={addEmail}
              onChange={e => { setAddEmail(e.target.value); setAddError(null); }}
              onKeyDown={e => e.key === "Enter" && onAdd()}
              placeholder="user@example.com"
              disabled={addState === "loading"}
              className="flex-1 min-w-0"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={onAdd}
              loading={addState === "loading"}
              disabled={addState === "loading" || !addEmail.trim()}
              leftIcon={
                addState === "success"
                  ? <Success size="xs" />
                  : <Icon icon={Plus} size="xs" />
              }
              className="flex-shrink-0"
            >
              {addState === "loading" ? "Adding…" : addState === "success" ? "Added" : "Add"}
            </Button>
          </div>
          <AnimatePresence>
            {addError && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-1 text-2xs text-secondary mt-1.5 overflow-hidden"
              >
                <Warning size="xs" weight="fill" className="text-primary flex-shrink-0" />
                {addError}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        <div className="mx-5 border-t border-surface-divider" />

        {users.length === 0 ? (
          <EmptyState icon={UserCircle} title="No users yet" size="sm" />
        ) : (
          <AnimatePresence initial={false}>
            <div className="divide-y divide-surface-divider">
              {users.map(u => {
                const isCurrentUser = u.isCurrentAdmin === true || u.email === currentUserEmail;
                const isRemoving = removingEmail === u.email;
                return (
                  <motion.div
                    key={u.email}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, height: 0, overflow: "hidden" }}
                    className="flex items-center gap-3 px-5 py-2.5"
                  >
                    <Avatar user={u} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-primary truncate flex-1 min-w-0">
                          {u.email}
                        </span>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {isCurrentUser && (
                            <Badge tone="muted" size="sm">you</Badge>
                          )}
                          {u.role === "admin" && (
                            <Badge tone="outline" size="sm">Admin</Badge>
                          )}
                          <IconButton
                            variant="ghost"
                            size="sm"
                            aria-label={isCurrentUser ? "Cannot remove yourself" : `Remove ${u.email}`}
                            title={isCurrentUser ? "Cannot remove yourself" : `Remove ${u.email}`}
                            onClick={() => onRemove(u.email)}
                            disabled={isCurrentUser || isRemoving}
                            className="ml-0.5"
                          >
                            {isRemoving
                              ? <Refresh size="xs" className="animate-spin" />
                              : <Delete size="xs" />}
                          </IconButton>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {u.name && (
                          <span className="text-2xs text-muted truncate">{u.name}</span>
                        )}
                        {u.lastLoginAt ? (
                          <span className="text-2xs text-muted flex-shrink-0">
                            {u.name ? "· " : ""}last login {fmtRelative(u.lastLoginAt)}
                          </span>
                        ) : !u.name && (
                          <span className="text-2xs text-muted italic">never logged in</span>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </AnimatePresence>
        )}
      </div>
    )}

    <AnimatePresence>
      {removeError && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          className="fixed bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-surface-raised border border-surface-border text-primary text-xs px-3 py-2 rounded-lg shadow-lg z-toast"
        >
          <Warning size="xs" weight="fill" className="text-primary flex-shrink-0" />
          {removeError}
        </motion.div>
      )}
    </AnimatePresence>
  </motion.div>
);

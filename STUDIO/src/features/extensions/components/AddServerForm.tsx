import { useState } from "react";
import { motion } from "framer-motion";
import { Warning } from "@/ui/icons";
import { Button } from "@/ui/primitives/Button";
import { SegmentedControl } from "@/ui/primitives/SegmentedControl";
import { inputCls, labelCls } from "./ExtensionIcons";
import type { AddFormState } from "../types";

export type { AddFormState };

export const emptyForm: AddFormState = {
  name: "", displayName: "", type: "local",
  command: "", args: "", envVars: "",
  endpointUrl: "", authToken: "",
};

interface AddServerFormProps {
  isTauri:   boolean;
  onInstall: (form: AddFormState) => Promise<void>;
  onCancel:  () => void;
  loading:   boolean;
  error:     string | null;
}

export const AddServerForm = ({ isTauri, onInstall, onCancel, loading, error }: AddServerFormProps) => {
  const [form, setForm] = useState<AddFormState>(emptyForm);
  const set = (key: keyof AddFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [key]: key === "name" ? e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") : e.target.value }));

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-4"
    >
      {/* Type toggle */}
      <SegmentedControl
        aria-label="Server type"
        size="sm"
        value={form.type}
        onChange={(t) => setForm(f => ({ ...f, type: t }))}
        options={[
          { value: "local",  label: "Local process" },
          { value: "remote", label: "Remote URL" },
        ]}
      />

      {/* Identity */}
      <div className="space-y-3">
        <p className={labelCls}>Identity</p>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1.5">
            <p className="text-2xs text-muted">Identifier</p>
            <input type="text" value={form.name} onChange={set("name")}
              placeholder={form.type === "remote" ? "github" : "my-server"} className={inputCls} />
            <p className="text-3xs text-muted">lowercase · hyphens only</p>
          </div>
          <div className="space-y-1.5">
            <p className="text-2xs text-muted">Display name</p>
            <input type="text" value={form.displayName} onChange={set("displayName")}
              placeholder={form.type === "remote" ? "GitHub" : "My Server"} className={inputCls} />
          </div>
        </div>
      </div>

      {/* Remote */}
      {form.type === "remote" && (
        <div className="space-y-3">
          <p className={labelCls}>Connection</p>
          <div className="space-y-2.5">
            <div className="space-y-1.5">
              <p className="text-2xs text-muted">Endpoint URL</p>
              <input type="url" value={form.endpointUrl} onChange={set("endpointUrl")}
                placeholder="https://api.example.com/mcp/" className={inputCls} />
              <p className="text-3xs text-muted">MCP-compatible HTTP endpoint</p>
            </div>
            <div className="space-y-1.5">
              <p className="text-2xs text-muted">
                Auth token <span className="text-disabled">(optional)</span>
              </p>
              <input type="password" value={form.authToken} onChange={set("authToken")}
                placeholder="Bearer token or API key" className={inputCls} />
            </div>
          </div>
        </div>
      )}

      {/* Local */}
      {form.type === "local" && isTauri && (
        <div className="space-y-3">
          <p className={labelCls}>Command</p>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1.5">
              <p className="text-2xs text-muted">Executable</p>
              <input type="text" value={form.command} onChange={set("command")} placeholder="npx" className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <p className="text-2xs text-muted">Arguments</p>
              <input type="text" value={form.args} onChange={set("args")}
                placeholder="-y @scope/server-name" className={inputCls} />
              <p className="text-3xs text-muted">space-separated</p>
            </div>
          </div>
          <div className="space-y-3">
            <p className={labelCls}>Environment</p>
            <div className="space-y-1.5">
              <textarea value={form.envVars} onChange={set("envVars")} rows={3}
                placeholder={"GITHUB_TOKEN=ghp_xxxx\nANOTHER_KEY=value"}
                className={`${inputCls} resize-none font-mono leading-relaxed`} />
              <p className="text-3xs text-muted">KEY=value · one per line</p>
            </div>
          </div>
        </div>
      )}

      {error && (
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="flex items-center gap-1.5 text-xs text-secondary bg-surface-raised border border-surface-border px-3 py-2 rounded-xl">
          <Warning size="xs" weight="fill" className="text-primary flex-shrink-0" />
          {error}
        </motion.p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button variant="primary" size="sm" onClick={() => onInstall(form)} loading={loading}>
          {loading ? "Adding…" : "Add server"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </motion.div>
  );
};

import { motion } from "framer-motion";
import { PlusIcon as Plus } from "@/ui/icons";
import { Close, Icon } from "@/ui/icons";
import { AppLogo } from "@/ui/brand";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
import { Toggle } from "@/ui/primitives/Toggle";
import { StudioMarkIcon } from "./ExtensionIcons";

export interface AppConnectModalConfig {
  name:        string;
  logo?:       string;
  logoNode?:   React.ReactNode;
  description: string;
  developer:   string;
  version?:    string;
  category?:   string;
  privacyUrl?: string;
  tosUrl?:     string;
}

interface AppConnectModalProps {
  config:            AppConnectModalConfig;
  onClose:           () => void;
  onPrimary:         () => void;
  primaryLabel:      string;
  primaryDisabled?:  boolean;
  primaryNote?:      string;
  onDestructive?:    () => void;
  destructiveLabel?: string;
  isLoading?:        boolean;
  refMemories:       boolean;
  onToggleRef:       () => void;
}

// NOTE: The gradient header (sky→blue→indigo) is an intentional marketing
// surface (user-confirmed, D-408) and is exempt from the strict-neutral palette.
// The lower info section is regular UI and is fully tokenised / strict-neutral.
export const AppConnectModal = ({
  config,
  onClose,
  onPrimary,
  primaryLabel,
  primaryDisabled,
  primaryNote,
  onDestructive,
  destructiveLabel,
  isLoading,
  refMemories,
  onToggleRef,
}: AppConnectModalProps) => (
  <motion.div
    className="fixed inset-0 z-modal flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.18 }}
    onClick={onClose}
  >
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 20 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-sm mx-4 mb-4 sm:mb-0 rounded-3xl shadow-2xl overflow-hidden"
      onClick={e => e.stopPropagation()}
    >
      {/* Gradient header — intentional marketing surface (D-408) */}
      <div className="relative bg-gradient-to-br from-surface-raised via-surface-raised to-surface-raised px-6 pt-7 pb-9 flex flex-col items-center text-center">
        <IconButton
          aria-label="Close"
          onClick={onClose}
          className="absolute top-3.5 right-3.5 h-auto w-auto rounded-full bg-white/20 p-1.5 text-white hover:bg-white/30"
        >
          <Close size="xs" className="text-white" />
        </IconButton>

        {/* Dual icons */}
        <div className="flex items-center gap-3 mb-5">
          <AppLogo
            src={config.logo}
            label={config.name}
            size="xl"
            className="!rounded-xl bg-white shadow-md"
            fallback={
              config.logoNode ?? (
                <span className="text-2xl font-bold text-secondary select-none">
                  {config.name.charAt(0).toUpperCase()}
                </span>
              )
            }
          />
          <div className="w-7 h-7 rounded-full bg-white/25 flex items-center justify-center">
            <Icon icon={Plus} size="xs" className="text-white" />
          </div>
          <div className="w-[52px] h-[52px] rounded-xl bg-gradient-to-br from-surface-raised via-surface-raised to-surface-raised shadow-md flex items-center justify-center">
            <StudioMarkIcon size={20} />
          </div>
        </div>

        <h2 className="text-lg font-bold text-white leading-snug mb-2">Add {config.name} to Studio</h2>
        <p className="text-sm text-white/80 leading-relaxed max-w-[264px]">{config.description}</p>

        <div className="mt-5 flex flex-col items-center gap-1.5">
          <Button
            variant="ghost"
            onClick={onPrimary}
            disabled={primaryDisabled || isLoading}
            className="h-auto px-8 py-2.5 rounded-full bg-white text-secondary font-semibold text-sm shadow-sm hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "Connecting…" : primaryLabel}
          </Button>
          {primaryNote && <p className="text-2xs text-white/60 mt-0.5">{primaryNote}</p>}
        </div>
      </div>

      {/* Lower info section — strict-neutral */}
      <div className="bg-surface-base px-5 py-4 space-y-3">
        {/* Memories toggle */}
        <div className="flex items-start gap-3 pb-3 border-b border-surface-border">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-primary mb-0.5">Reference memories and chats.</p>
            <p className="text-xs text-muted leading-relaxed">
              Allow Studio to reference relevant chats and memories when sharing data with {config.name}.
            </p>
          </div>
          <div className="flex-shrink-0 mt-0.5">
            <Toggle checked={refMemories} onChange={() => onToggleRef()} aria-label="Reference memories and chats" />
          </div>
        </div>

        {/* Privacy */}
        <div className="space-y-1.5 text-xs text-secondary leading-relaxed">
          <p><span className="font-semibold text-primary">You're in control.</span>{" "}Studio always respects your training data preferences.</p>
          <p><span className="font-semibold text-primary">Apps may introduce elevated risk.</span>{" "}Studio is built to protect your data, but apps may attempt to access your information.</p>
          <p>
            <span className="font-semibold text-primary">Data shared with this app.</span>{" "}
            By adding this app, you allow it to access basic information.{" "}
            {config.privacyUrl && <a href={config.privacyUrl} target="_blank" rel="noopener noreferrer" className="text-secondary underline hover:text-primary transition-colors">Learn more</a>}
          </p>
        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-surface-border flex items-center justify-between">
          <p className="text-2xs text-muted">
            {config.developer}
            {config.version  && <span className="ml-1.5 opacity-60">v{config.version}</span>}
            {config.category && <span className="ml-1.5 opacity-60">· {config.category}</span>}
          </p>
          <div className="flex items-center gap-3 text-2xs">
            {config.tosUrl     && <a href={config.tosUrl}     target="_blank" rel="noopener noreferrer" className="text-muted hover:text-primary transition-colors">Terms</a>}
            {config.privacyUrl && <a href={config.privacyUrl} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-primary transition-colors">Privacy</a>}
            {onDestructive && destructiveLabel && (
              <Button variant="ghost" onClick={onDestructive} className="h-auto w-auto px-0 py-0 text-xs font-medium text-primary underline-offset-2 hover:underline">
                {destructiveLabel}
              </Button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  </motion.div>
);

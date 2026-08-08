import { useState, useEffect, useRef } from "react";
import { Keyboard } from "@/ui/icons";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";

interface ShortcutRecorderProps {
  value: string[];
  onChange: (keys: string[]) => void;
  disabled?: boolean;
}

/**
 * Component for recording keyboard shortcuts.
 * Captures key combinations and displays them.
 *
 * (Moved into the settings feature — ShortcutsView is its sole consumer.)
 * Tokenized: surface/text/border via semantic tokens; the token system handles
 * light→dark switches, so per-element theme-switch transitions are dropped.
 */
export const ShortcutRecorder = ({
  value,
  onChange,
  disabled = false,
}: ShortcutRecorderProps) => {
  const [isRecording, setIsRecording] = useState(false);
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set());
  const recordingRef = useRef(false);

  useEffect(() => {
    recordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!recordingRef.current) return;

      event.preventDefault();
      event.stopPropagation();

      const keys = new Set<string>();

      if (event.ctrlKey) keys.add("ctrl");
      if (event.shiftKey) keys.add("shift");
      if (event.altKey) keys.add("alt");
      if (event.metaKey) keys.add("meta");

      const key = event.key.toLowerCase();
      if (!["control", "shift", "alt", "meta"].includes(key)) {
        keys.add(key);
      }

      setPressedKeys(keys);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!recordingRef.current) return;

      event.preventDefault();
      event.stopPropagation();

      const hasModifier = pressedKeys.has("ctrl") ||
                          pressedKeys.has("shift") ||
                          pressedKeys.has("alt") ||
                          pressedKeys.has("meta");

      const regularKeys = Array.from(pressedKeys).filter(
        (k) => !["ctrl", "shift", "alt", "meta"].includes(k),
      );

      if (hasModifier && regularKeys.length > 0) {
        onChange(Array.from(pressedKeys));
        setIsRecording(false);
        setPressedKeys(new Set());
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [isRecording, pressedKeys, onChange]);

  const handleStartRecording = () => {
    if (disabled) return;
    setIsRecording(true);
    setPressedKeys(new Set());
  };

  const handleCancelRecording = () => {
    setIsRecording(false);
    setPressedKeys(new Set());
  };

  const handleClear = () => {
    onChange(["ctrl", "shift", "r"]); // Reset to default
  };

  return (
    <div className="flex items-center gap-2">
      {isRecording ? (
        <>
          <div className="flex-1 px-3 py-2 bg-surface-raised border border-primary rounded-lg text-sm font-medium text-primary">
            {pressedKeys.size > 0 ? (
              <span className="flex gap-1">
                {Array.from(pressedKeys).map((key, i) => (
                  <kbd
                    key={i}
                    className="px-2 py-0.5 bg-surface-base border border-surface-border rounded text-xs font-mono text-primary"
                  >
                    {key.toUpperCase()}
                  </kbd>
                ))}
              </span>
            ) : (
              <span className="text-muted">Press keys...</span>
            )}
          </div>
          <IconButton
            variant="ghost"
            size="sm"
            aria-label="Cancel recording"
            onClick={handleCancelRecording}
            className="shrink-0"
          >
            <Keyboard size="md" />
          </IconButton>
        </>
      ) : (
        <>
          <div className="flex-1 flex gap-1 px-3 py-2 bg-surface-base border border-surface-border rounded-lg">
            {value.map((key, i) => (
              <kbd
                key={i}
                className="px-2 py-0.5 bg-surface-raised rounded text-xs font-mono text-secondary"
              >
                {key.toUpperCase()}
              </kbd>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleStartRecording}
            disabled={disabled}
            className="shrink-0"
          >
            Change
          </Button>
          {value.join("+") !== "ctrl+shift+r" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              disabled={disabled}
              className="shrink-0"
            >
              Reset
            </Button>
          )}
        </>
      )}
    </div>
  );
};

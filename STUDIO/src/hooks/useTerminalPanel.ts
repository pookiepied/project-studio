import { useState, useCallback } from "react";

export function useTerminalPanel() {
  const [terminalOpen,  setTerminalOpen]  = useState(false);
  const [terminalWidth, setTerminalWidth] = useState(380);

  const handleCloseTerminal = useCallback(() => {
    setTerminalOpen(false);
  }, []);

  return {
    terminalOpen,
    setTerminalOpen,
    terminalWidth,
    setTerminalWidth,
    handleCloseTerminal,
  };
}

/**
 * workspaceLayoutStore — tiny module-level observable for cross-cutting layout
 * signals that don't fit the normal top-down props flow.
 *
 * Right now it carries the right workspace panel's width so the top-center dock
 * (rendered up in the shell chrome, a sibling of the chat page) can recenter
 * itself over the chat area and collapse to an icon when space gets tight —
 * without threading state through MainLayout.
 */

import { useSyncExternalStore } from "react";

let rightPanelWidth = 0;
let leftPanelWidth = 0;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

/** Width (px) the right workspace panel currently occupies; 0 when closed. */
export function setRightPanelWidth(width: number): void {
  const next = Math.max(0, Math.round(width));
  if (next === rightPanelWidth) return;
  rightPanelWidth = next;
  emit();
}

/** Width (px) the left workspace sidebar currently occupies; 0 when closed. */
export function setLeftPanelWidth(width: number): void {
  const next = Math.max(0, Math.round(width));
  if (next === leftPanelWidth) return;
  leftPanelWidth = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getRightSnapshot(): number {
  return rightPanelWidth;
}

function getLeftSnapshot(): number {
  return leftPanelWidth;
}

/** React binding — re-renders the consumer whenever the right panel width changes. */
export function useRightPanelWidth(): number {
  return useSyncExternalStore(subscribe, getRightSnapshot, getRightSnapshot);
}

/** React binding — re-renders the consumer whenever the left sidebar width changes. */
export function useLeftPanelWidth(): number {
  return useSyncExternalStore(subscribe, getLeftSnapshot, getLeftSnapshot);
}

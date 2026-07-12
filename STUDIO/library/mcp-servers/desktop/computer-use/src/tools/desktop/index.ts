// Level 1 — Monitoring (read-only system state)
export * from "./monitoring/index.js";

// Level 2 — Control (processes, services, elevation)
export * from "./control/index.js";

// Level 3 — Settings (registry, display, audio, power, firewall, env vars, apps, scheduler)
export * from "./settings/index.js";

// Level 4 — Automation (screenshot, vision/OCR, window management, UI elements, mouse/keyboard)
export * from "./automation/index.js";

// Network — connectivity, Wi-Fi, adapters, hosts file
export * from "./network/index.js";

// Security — users, groups
export * from "./security/index.js";

// System UI — Clipboard, notifications, dialogs
export * from "./system-ui/index.js";

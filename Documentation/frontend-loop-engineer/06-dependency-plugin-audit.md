# Frontend Loop Engineer - Dependency and Plugin Audit

Status: First-pass dependency audit recorded on 2026-07-10.

## Scripts

- `dev`: Vite desktop dev server.
- `build`: `tsc && vite build`.
- `lint`: ESLint flat config.
- `preview`: Vite preview.
- `tauri`: Tauri wrapper script.
- `vendor:sync`: vendor sync script.
- `web:dev`, `web:build`, `web:preview`: web build path.
- `installer:assets`: installer asset generation.

No `test` or `typecheck` script exists. Typecheck is included in `build`.

## Dependency Classification

| Dependency | Classification | Evidence |
|---|---|---|
| `react`, `react-dom` | Active | App entry and React components. |
| `framer-motion` | Active | App shell, UI, feature components. |
| `@phosphor-icons/react` | Active | Icons across UI/features. |
| `sonner` | Active | App toaster and route notifications. |
| `@radix-ui/react-select` | Active | `ui/primitives/Select.tsx`. |
| `@tauri-apps/api` | Active | App/core/runtime/feature native integration. |
| `@tauri-apps/plugin-*` | Active / required by Tauri | Autostart, dialog, fs, shortcut, notification, opener, process, updater. |
| `@xterm/xterm`, `@xterm/addon-fit` | Active | Workspace terminal. |
| `cmdk` | Active | Command palette. |
| `js-tiktoken` | Active | Token estimator. |
| `katex` | Active | Markdown LaTeX renderer. |
| `mermaid` | Active | Markdown Mermaid renderer. |
| `pdfjs-dist` | Active | PDF attachment service. |
| `react-markdown`, `remark-gfm` | Active | Markdown rendering. |
| `react-syntax-highlighter` | Active | Code rendering. |
| `recharts` | Active | Activity charts. |
| `simple-icons` | Active | Brand/provider/app icons. |
| `three`, `react-force-graph-3d` | Active | Memories graph. |
| `@fontsource-*` | Active for web build | Imported by `web/web-main.tsx`. |

## Dev Dependency Classification

| Dependency | Classification | Evidence |
|---|---|---|
| `typescript` | Required tooling | `tsc` in build. |
| `vite`, `@vitejs/plugin-react` | Required tooling | Vite configs. |
| `eslint`, `@eslint/js`, `typescript-eslint`, plugins, `globals` | Required tooling | ESLint flat config. |
| `tailwindcss`, `postcss`, `autoprefixer` | Required styling tooling | Tailwind/PostCSS configs. |
| `@tauri-apps/cli` | Required desktop tooling | `tauri` script. |
| `@types/*` | Required type support | React/Three/syntax highlighter types. |
| `@vscode/ripgrep` | Unknown / likely developer utility | Not observed in frontend source; check scripts before removal. |

## Tauri / Native Plugins

Rust `Cargo.toml` includes matching Tauri plugins plus `single-instance`,
`serde`, `tokio`, `reqwest`, `portable-pty`, `keyring`, and Windows-specific
WebView/DWM dependencies. These are outside frontend-only refactor scope except
where frontend plugin calls need typed wrappers.

## Build Observations

`npm run build` passes but reports a 10.9 MB minified `index` chunk and several
dynamic-import warnings where modules are also statically imported. This is not
a correctness failure for the desktop app, but it is a performance and web-build
concern.

No dependencies were removed in this audit pass.

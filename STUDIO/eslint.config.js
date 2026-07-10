import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

// Flat config (ESLint 9). Lint is NOT part of the build (`tsc && vite build`).
// Run it via `npm run lint` for the raw report, or `npm run ratchet:lint` for the
// pass/fail gate, which fails only on violations new since STUDIO/gate/lint-baseline.json.
//
// Design-system guardrails are ERROR: existing violations are held at the baseline and
// burned down; new code must adopt primitives and tokens. Rationale lives in
// Documentation/frontend-loop-engineer-master-prompt.md § 6 and .roundtable/CHARTER.md.

/**
 * Token guardrails. Apply everywhere, including the primitives -- a primitive has no
 * more license to hardcode a hex value than a feature does.
 */
const TOKEN_GUARDRAILS = [
  {
    selector: "Literal[value=/text-\\[/]",
    message:
      "DS: use a named font-size token (text-3xs/2xs/xs/sm/base/lg…), not an arbitrary text-[..].",
  },
  {
    selector: "TemplateElement[value.raw=/text-\\[/]",
    message:
      "DS: use a named font-size token (text-3xs/2xs/xs/sm/base/lg…), not an arbitrary text-[..].",
  },
  {
    selector: "Literal[value=/#[0-9a-fA-F]{6}/]",
    message: "DS: use a semantic color token (surface-*/text-*), not a raw hex value.",
  },
  {
    selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{6}/]",
    message: "DS: use a semantic color token (surface-*/text-*), not a raw hex value.",
  },
  {
    selector: "Literal[value=/rounded-\\[/]",
    message:
      "DS: use a named border-radius token (rounded-sm/md/lg/xl/2xl/3xl), not an arbitrary rounded-[..].",
  },
  {
    selector: "TemplateElement[value.raw=/rounded-\\[/]",
    message:
      "DS: use a named border-radius token (rounded-sm/md/lg/xl/2xl/3xl), not an arbitrary rounded-[..].",
  },
  {
    selector: "Literal[value=/duration-\\[/]",
    message:
      "DS: use a named duration token (duration-fast/normal/slow), not an arbitrary duration-[..].",
  },
  {
    selector: "TemplateElement[value.raw=/duration-\\[/]",
    message:
      "DS: use a named duration token (duration-fast/normal/slow), not an arbitrary duration-[..].",
  },
];

const NO_RAW_BUTTON = {
  selector: "JSXOpeningElement[name.name='button']",
  message: "DS: use <Button>/<IconButton> from @/ui/primitives instead of a raw <button>.",
};

/**
 * The only files allowed to render a native <button>: the control primitives themselves.
 * They are what the rule tells everyone else to reach for, so they cannot obey it.
 *
 * Deliberately not the whole of ui/primitives/ -- most files there are composites that
 * merely live in the folder (AskUserQuestionCard, HarnessPermissionModal,
 * ConnectionStatusBar, ExternalLink, VideoPlayer). Their raw buttons are real debt and
 * stay counted.
 */
const CONTROL_PRIMITIVES = [
  "src/ui/primitives/Button.tsx",
  "src/ui/primitives/IconButton.tsx",
  "src/ui/primitives/SegmentedControl.tsx",
  "src/ui/primitives/Toggle.tsx",
];

export default tseslint.config(
  {
    ignores: [
      "dist",
      "dist-web",
      "node_modules",
      "src-tauri",
      "web",
      "daemon",
      "mcp-servers",
      "scripts",
      "public",
      "vendor",
      "**/*.config.js",
      "**/*.config.ts",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      // tsc already enforces unused via noUnusedLocals/Parameters; keep ESLint quiet on these
      // and on `any` so the baseline surfaces design-system issues, not type-style noise.
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",

      "no-restricted-syntax": ["error", NO_RAW_BUTTON, ...TOKEN_GUARDRAILS],
    },
  },
  {
    files: CONTROL_PRIMITIVES,
    rules: {
      "no-restricted-syntax": ["error", ...TOKEN_GUARDRAILS],
    },
  },
);

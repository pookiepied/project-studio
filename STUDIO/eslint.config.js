import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

// Flat config (ESLint 9). Lint is NOT part of the build (`tsc && vite build`);
// run with `npm run lint`. Design-system guardrails are ERROR (self-enforcing per
// Phase 6 T6.3): existing violations surface as errors going forward; new code
// must adopt primitives/tokens. See frontend-revamp/02-PLAN.md § T6.3 + D-604.
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

      // ── Design-system guardrails (ERROR — self-enforcing per § T6.3) ──
      // D-401 strict-neutral + D-405 typography scale + primitives adoption.
      // Existing violations surface as errors; new code must comply.
      // Future: add `outline-none` rule pending eslint-plugin-tailwindcss (C-426).
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name='button']",
          message:
            "DS: use <Button>/<IconButton> from @/ui/primitives instead of a raw <button>.",
        },
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
          message:
            "DS: use a semantic color token (surface-*/text-*), not a raw hex value.",
        },
        {
          selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{6}/]",
          message:
            "DS: use a semantic color token (surface-*/text-*), not a raw hex value.",
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
      ],
    },
  },
);

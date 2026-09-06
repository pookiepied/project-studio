import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * The linter, and what it is here for.
 *
 * This is the process that spawns children, opens sockets, holds a database
 * and decides what a model is allowed to touch. The rules worth having are
 * the ones that can see types: a promise nobody awaited, a value that arrived
 * as `any` from the wire and was used as though it had been checked, a
 * comparison the compiler already knows the answer to. None of those are
 * visible to a syntax-only pass, and all of them are what this codebase's
 * reviews have been finding by hand.
 *
 * The frontend's linter went in first and found a real defect on its first
 * run. This one is the same idea with the React half removed.
 *
 * ---- Not enabled ----------------------------------------------------------
 *
 * Formatting, all of it. The diffs here are meant to be read, and a linter
 * that rewrites whitespace turns a review into a hunt for the line that
 * mattered.
 *
 * Conventions this codebase has already settled in prose - naming, import
 * order, how a comment is written - stay settled in prose. A rule that
 * disagrees with a house convention gets switched off within a week, and a
 * config full of switched-off rules teaches nobody anything.
 */
export default tseslint.config(
  {
    ignores: ["dist", "node_modules", "patches", "coverage"],
  },
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "*.config.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      /**
       * The bans this codebase already states in prose, enforced where they
       * are broken rather than where someone happens to read.
       */
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",

      /**
       * A leading underscore already means "required by the signature, unused
       * on purpose" here, and `noUnusedParameters` in the tsconfig honours
       * it. The linter is told the same convention rather than answered once
       * per occurrence.
       */
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],

      /**
       * Off, for the same reason as in the frontend: an `async` function that
       * returns a promise-typed value without awaiting it is not a mistake,
       * and this codebase writes them on purpose wherever an interface's
       * other implementations do await.
       */
      "@typescript-eslint/require-await": "off",

      /**
       * `void promise` is this codebase's way of saying "started, not
       * awaited, deliberately". Everything else must be handled: an
       * unhandled rejection in a supervisor or a tool run is a turn that
       * never settles.
       */
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  {
    /**
     * Tests build shapes the app would never build, on purpose: a malformed
     * wire payload, a record with a field missing, a stub whose return the
     * compiler cannot see through. That is the point of them.
     */
    files: ["tests/**/*.ts"],
    rules: {
      /**
       * A test reaches for `any` to do things the app never does: replace
       * `Date.now`, hand a stub where a full capability descriptor belongs,
       * build a payload the schema would reject. And it asserts on values a
       * guard has already settled a line above - `it.runIf(GIT)` then `GIT!`
       * - where the compiler cannot follow. The bans exist to keep the
       * production code honest about what it knows; a test's whole job is to
       * arrange what production would refuse.
       */
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/only-throw-error": "off",
    },
  },
);

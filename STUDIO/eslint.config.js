import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

/**
 * The linter, and what it is here to catch.
 *
 * This app went a long way without one, and the read-through that finally
 * added it turned up the reason to have it: a `useEffect` that held a timer
 * and listed `phase` among its dependencies, where `phase` is rebuilt fresh
 * on every update. Any unrelated render cancelled the timer and started no
 * replacement, so a status capsule that should hold for three seconds held
 * for the rest of the conversation. It was found by reading. It is exactly
 * what `react-hooks/exhaustive-deps` and its neighbours exist to point at,
 * for free, on every save.
 *
 * ---- Type-aware, deliberately -------------------------------------------
 *
 * The rules worth having here need types. A promise dropped on the floor, a
 * condition that is always true, a template literal quietly stringifying an
 * object -- none of those are visible to a linter that only sees syntax, and
 * all of them are the kind of thing this codebase's own review has had to
 * catch by hand. The cost is that a lint run type-checks, so it is slower
 * than a syntax-only pass; it is still seconds, and it is the difference
 * between a linter that finds real defects and one that argues about style.
 *
 * ---- What is deliberately not enabled -----------------------------------
 *
 * Formatting rules, all of them. Nothing here reformats code: the diffs in
 * this repository are meant to be read, and a linter that rewrites whitespace
 * turns every review into a search for the one line that matters.
 *
 * Stylistic preferences the codebase has already decided in prose -- naming,
 * import order, arrow-vs-function -- stay decided in prose. A rule that
 * disagrees with a house convention would be turned off within a week, and a
 * config full of disabled rules teaches nobody anything.
 */
export default tseslint.config(
  {
    // Build output, native artefacts, and the linter's own config.
    ignores: ['dist', 'src-tauri/target', 'node_modules'],
  },
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      // `configs.flat` rather than the top-level name: the plugin still ships
      // the legacy shape under both, and only this one declares its plugins
      // the way flat config requires.
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      /**
       * The three the house style already bans in prose, raised from
       * suggestion to error so the ban is enforced where it is broken rather
       * than where someone happens to read.
       */
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',

      /**
       * A leading underscore already means "present because the signature
       * needs it, unused on purpose" throughout this codebase, and
       * `noUnusedLocals` in the tsconfig honours it. The linter is told the
       * same convention rather than being answered twenty times over.
       */
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],

      /**
       * Off: an `async` function that returns a promise-typed value without
       * awaiting it is not a mistake, and this codebase writes plenty of them
       * on purpose -- a stubbed transport, an interface whose other
       * implementations do await, a handler whose signature is fixed by its
       * caller. The rule found a hundred of those and no defects.
       */
      '@typescript-eslint/require-await': 'off',

      /**
       * ---- The React Compiler rules, deliberately off --------------------
       *
       * `eslint-plugin-react-hooks` v7 ships the compiler's own constraints
       * beside the classic hook rules. They describe what a component must
       * look like for React Compiler to optimize it: no ref read during
       * render, no `setState` called straight from an effect, no mutation of
       * anything that arrived as a prop or an argument.
       *
       * This app does not run the compiler -- `vite.config.ts` uses the React
       * plugin without it -- so none of these change what ships today. They
       * are a to-do list for adopting it, forty entries long, and adopting it
       * is its own task with its own verification: the "latest value" ref
       * written during render is a documented React pattern that the compiler
       * forbids and nothing else does, and each `setState` in an effect has
       * to be read to see whether it is a cascade or a measurement.
       *
       * Off rather than warned, because a lint run that always prints forty
       * lines is a lint run people stop reading, and that costs more than
       * these rules are worth before the compiler is actually in use. When it
       * goes in, this block is the checklist: delete it and fix what appears.
       */
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/globals': 'off',
      'react-hooks/preserve-manual-memoization': 'off',

      /**
       * Off: this reports a file that exports anything besides components,
       * because Fast Refresh then reloads the module instead of preserving
       * component state. Real, and small -- it costs a re-render in the dev
       * server and nothing at all in a build. The codebase deliberately keeps
       * a component's own helpers and constants beside it, where they are
       * read, and its tests import them from there. Splitting eighteen files
       * to spare the dev server a re-render is the wrong trade.
       */
      'react-refresh/only-export-components': 'off',

      /**
       * `void promise` is this codebase's own way of saying "started, not
       * awaited, on purpose" and it appears throughout the stores. The rule
       * stays on for everything else, because an unhandled rejection in a
       * store is a state that never settles.
       */
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],

      /**
       * An `async` handler passed where a `void` callback is expected is how
       * a rejection escapes into nothing. Checked everywhere except JSX
       * attributes, where React's own event props are typed `void` and the
       * codebase's answer is the `() => void thing()` wrapper it already
       * writes.
       */
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  {
    // Tests say what they mean about shapes the app would never build, and
    // they assert on values the compiler cannot see through a mock.
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      /**
       * Tauri's `invoke` rejects with a plain object, not an `Error`, and the
       * transport tests throw exactly that to prove the seam survives it. A
       * rule that insists on an Error here would be asking the tests to
       * simulate something other than what actually happens.
       */
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
)

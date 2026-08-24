import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

/**
 * The test config, merged onto the app's own.
 *
 * Merged rather than written fresh so the `@` alias, the React plugin and the
 * Tailwind plugin are the same ones the app builds with — a second copy of
 * the alias table is a second thing to forget when a path moves.
 *
 * The environment stays `node`. Only the settings-pane tests need a DOM, and
 * they ask for one per file with a `@vitest-environment jsdom` docblock —
 * booting jsdom for the transport tests as well cost about eighty seconds of
 * environment setup for tests that never touch a document.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.{ts,tsx}'],
      restoreMocks: true,
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }),
)

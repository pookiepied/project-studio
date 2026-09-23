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
 * The environment stays `node`. A test that needs a DOM asks for one itself,
 * per file, with a `@vitest-environment jsdom` docblock — which is most of
 * them now, but not all: the parsers and the transport still run without a
 * document, and booting jsdom for those cost about eighty seconds of
 * environment setup for tests that never touch one.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // `tests/` holds the checks that read the tree from outside it -- a
      // source scan cannot import what it is scanning through the plugins
      // that transform it.
      include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
      restoreMocks: true,
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }),
)

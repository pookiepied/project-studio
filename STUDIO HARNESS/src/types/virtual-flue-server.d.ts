/**
 * Ambient types for the `virtual:flue/server` module.
 *
 * The module exists only inside a Vite graph running the `@flue/vite`
 * plugin: it resolves to that package's own node-server bootstrap
 * (`dist/bootstrap/node-server.mjs`), which exposes the application
 * lifecycle the generated entry used to import. TypeScript never sees the
 * resolution, so the surface is declared here, mirrored from the real
 * exported types rather than restated - a drift between the two is caught
 * by any change to `@flue/vite`'s public surface.
 *
 * The file must stay a global script (no top-level imports), because an
 * ambient module declaration is only valid outside a module; the types are
 * referenced through `import()` expressions instead.
 */
declare module "virtual:flue/server" {
  export function loadFlueNodeApplication(
    options?: import("@flue/vite").LoadFlueNodeApplicationOptions,
  ): Promise<import("@flue/vite").LoadedFlueNodeApplication>;
}

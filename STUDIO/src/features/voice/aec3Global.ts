/**
 * The echo-canceller library assigns its embedded WebAssembly to a global it
 * never declares (`WebRtcAec3Wasm = "data:..."`), which `aec3.ts` then reads.
 * In a module - the worklet, or any dev-server build - that assignment is a
 * strict-mode error unless the global already exists, so it is created here,
 * imported ahead of the library.
 */
const scope = globalThis as { WebRtcAec3Wasm?: string }
scope.WebRtcAec3Wasm ??= ''

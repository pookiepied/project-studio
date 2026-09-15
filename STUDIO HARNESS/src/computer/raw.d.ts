/**
 * The driver script, imported as a string so it travels inside the bundle.
 *
 * Vite answers `?raw` with the file's text; this is only the type of that
 * answer. The script is written to disk at first use, because Windows
 * PowerShell reads a file and a command line has a length it will not carry
 * a script of this size past.
 */
declare module "*.ps1?raw" {
  const source: string;
  export default source;
}

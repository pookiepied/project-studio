export const ARCHIVE_DEFINITIONS = [{
  name: "read_archive_manifest",
  description: "List ZIP or TAR archive contents without extraction, with bounded entries and unsafe-path warnings.",
  inputSchema: { type: "object", properties: { path: { type: "string", description: "Path to a ZIP or uncompressed TAR archive." }, max_entries: { type: "number", description: "Default 500, max 10000" }, offset: { type: "number", description: "Entry offset for paging" } }, required: ["path"] },
}] as const;

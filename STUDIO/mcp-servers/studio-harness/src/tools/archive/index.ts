import { wrapTool } from "../tool-contract.js";
import { readArchiveManifest as raw } from "./manifest.js";
export const readArchiveManifest = wrapTool("read_archive_manifest", raw);

import { dirname } from "node:path";

import { sqlite } from "@flue/runtime/node";

import {
  ensureDirectory,
  flueDatabasePath,
  resolveConfigured,
} from "./platform/paths.js";

/**
 * Flue's durable execution journal.
 *
 * The default used to be `./data/flue.db`, resolved against the working
 * directory. The harness runs with the user's project as its working directory,
 * so that put Flue's journal inside whatever repository the user happened to
 * open — a different database per project, each one showing up in their own
 * `git status`. `platform/paths.ts` names this as one of two bugs that had
 * already happened once; this was the second of them, still present.
 *
 * `PROJECT_STUDIO_DB_PATH` still overrides it, and now goes through
 * `resolveConfigured`, so a relative override means "inside the Studio home"
 * rather than "wherever this process started".
 */
const path = process.env.PROJECT_STUDIO_DB_PATH
  ? resolveConfigured(process.env.PROJECT_STUDIO_DB_PATH)
  : flueDatabasePath();

// Flue opens the file rather than creating the tree, and on a first run the
// directory does not exist yet.
ensureDirectory(dirname(path));

export default sqlite(path);

import { wrapTool } from "../tool-contract.js";
import { readNotebook as raw } from "./read-notebook.js";
export const readNotebook = wrapTool("read_notebook", raw);

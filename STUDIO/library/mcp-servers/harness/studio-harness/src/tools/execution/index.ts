import { wrapTool } from "../tool-contract.js";
import {
  startProcess as _startProcess,
  readProcessOutput as _readProcessOutput,
  writeProcessInput as _writeProcessInput,
  stopProcess as _stopProcess,
  listProcesses as _listProcesses,
  commandExists as _commandExists,
} from "./process_manager.js";

export { executeBash } from "./bash.js";
export { executePowerShell } from "./powershell.js";
export { runRepl } from "./repl.js";

export const startProcess = wrapTool("start_process", _startProcess);
export const readProcessOutput = wrapTool("read_process_output", _readProcessOutput);
export const writeProcessInput = wrapTool("write_process_input", _writeProcessInput);
export const stopProcess = wrapTool("stop_process", _stopProcess);
export const listProcesses = wrapTool("list_processes", _listProcesses);
export const commandExists = wrapTool("command_exists", _commandExists);

import {
  parseCommand,
  parseCommandDetail,
  parseCommandExpansion,
  parseCommandListing,
  type CommandDetail,
  type CommandListing,
  type CommandRecord,
} from '../contracts'
import type { HarnessResult, Requester } from './request'

/**
 * `/api/commands`: the slash commands, the files that failed to be one, and
 * the person's own commands as they write them. Expansion is a route too,
 * so this side never reimplements the substitution rules.
 */

export const COMMANDS_PATH = '/api/commands'

export interface CommandClient {
  listCommands(): Promise<HarnessResult<CommandListing>>
  /** One command, with its file's halves when it has a file. */
  readCommand(id: string): Promise<HarnessResult<CommandDetail>>
  /** Creates or replaces one of the person's own commands. */
  saveCommand(
    id: string,
    source: { readonly description: string; readonly argumentHint: string; readonly body: string },
  ): Promise<HarnessResult<CommandRecord>>
  /** Removes one of the person's own commands. */
  removeCommand(id: string): Promise<HarnessResult<void>>
  /** The prompt a command expands to for the words typed after it. */
  expandCommand(id: string, args: string): Promise<HarnessResult<string>>
}

function commandPath(id: string, suffix = ''): string {
  return `${COMMANDS_PATH}/${encodeURIComponent(id)}${suffix}`
}

export function commandClient({ json, empty }: Requester): CommandClient {
  return {
    listCommands() {
      return json('GET', COMMANDS_PATH, undefined, parseCommandListing)
    },

    readCommand(id) {
      return json('GET', commandPath(id), undefined, parseCommandDetail)
    },

    saveCommand(id, source) {
      return json('PUT', commandPath(id), source, (value) => {
        if (typeof value !== 'object' || value === null) return null
        return parseCommand((value as Record<string, unknown>)['command'])
      })
    },

    removeCommand(id) {
      return empty('DELETE', commandPath(id))
    },

    expandCommand(id, args) {
      return json('POST', commandPath(id, '/expand'), { arguments: args }, parseCommandExpansion)
    },
  }
}

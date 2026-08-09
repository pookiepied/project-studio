import { StudioError } from "./error.js";
import { ErrorCodes } from "./codes.js";

export function toMcpError(err: unknown): { code: string; message: string } {
  if (err instanceof StudioError) return err.toResponse();
  if (err instanceof Error) return { code: ErrorCodes.INTERNAL, message: err.message.slice(0, 500) || "Internal error" };
  if (typeof err === "string") return { code: ErrorCodes.INTERNAL, message: err.slice(0, 500) };
  return { code: ErrorCodes.INTERNAL, message: "Internal error" };
}

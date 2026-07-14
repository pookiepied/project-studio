import type { Context } from "hono";
import { forbidden, unauthorized } from "../errors/appError";
import type { AppBindings } from "./app";

export interface RequestIdentity {
  userId: string;
}

export function requireIdentity(c: Context<AppBindings>): RequestIdentity {
  const userId = c.req.header("x-user-id")?.trim();
  if (!userId) throw unauthorized();
  c.set("userId", userId);
  return { userId };
}

export function requireRegistryWriter(c: Context<AppBindings>): void {
  const configuredToken = c.env.REGISTRY_WRITE_TOKEN?.trim();
  if (!configuredToken && c.env.ENVIRONMENT === "production") {
    throw forbidden("Registry writes require REGISTRY_WRITE_TOKEN in production.");
  }
  if (!configuredToken) return;

  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (token !== configuredToken) throw forbidden("Registry writes require an internal registry writer token.");
}

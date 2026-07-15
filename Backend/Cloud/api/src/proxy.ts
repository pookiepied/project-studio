import type { Env } from "./system/env";
import { ApiError, requireUserId, withUserHeader } from "./system/http";

type BindingName = "DATA" | "EXECUTION_RUNTIME" | "PLANNER_RUNTIME" | "AGENT_RUNTIME" | "GATEWAY";

export function proxyTo(env: Env, binding: BindingName, request: Request, targetPath: string): Response | Promise<Response> {
  const userId = requireUserId(request);
  const url = new URL(request.url);
  const target = new URL(`https://${binding.toLowerCase().replace(/_/g, "-")}.internal${targetPath}`);
  target.search = url.search;
  const init: RequestInit = {
    method: request.method,
    headers: withUserHeader(request, userId),
    body: bodyFor(request),
    redirect: "manual",
  };
  return env[binding].fetch(new Request(target, init));
}

export function proxyPath(env: Env, binding: BindingName, request: Request, prefix: string, replacement: string): Response | Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(prefix)) throw new ApiError("invalid_proxy_path", `Path must start with ${prefix}.`, 500);
  const suffix = url.pathname.slice(prefix.length);
  return proxyTo(env, binding, request, `${replacement}${suffix}`);
}

function bodyFor(request: Request): BodyInit | null {
  if (request.method === "GET" || request.method === "HEAD") return null;
  return request.body;
}

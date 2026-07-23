import type { ErrorHandler, NotFoundHandler } from "hono";
import { GatewayError, toErrorResponse } from "@/platform/errors";
import type { GatewayApp } from "./types";

export const handleNotFound: NotFoundHandler<GatewayApp> = (c) =>
  toErrorResponse(new GatewayError("ROUTE_NOT_FOUND", "Route not found."), c.get("requestId"));

export const handleError: ErrorHandler<GatewayApp> = (error, c) =>
  toErrorResponse(error, c.get("requestId"));

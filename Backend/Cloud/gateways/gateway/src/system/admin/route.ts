import { Hono } from "hono";
import type { GatewayEnv } from "../infrastructure/cloudflare/env";

export const adminRoute = new Hono<{ Bindings: GatewayEnv }>();

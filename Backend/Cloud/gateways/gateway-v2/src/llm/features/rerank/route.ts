import { Hono } from "hono";
import type { GatewayEnv } from "../../../system/infrastructure/cloudflare/env";

export const rerankRoute = new Hono<{ Bindings: GatewayEnv }>();

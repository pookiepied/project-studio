import { Hono } from "hono";
import type { Env } from "../types";
import { appRoutes } from "./apps";
import { composioRoutes } from "./composio";
import { genericConnectionRoutes } from "./genericConnections";
import { permissionRoutes } from "./permissions";

export const connectionRoutes = new Hono<{ Bindings: Env }>();

connectionRoutes.route("/", appRoutes);
connectionRoutes.route("/", composioRoutes);
connectionRoutes.route("/", genericConnectionRoutes);
connectionRoutes.route("/", permissionRoutes);

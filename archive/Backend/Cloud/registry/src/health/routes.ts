import { Hono } from "hono";
import { checkDatabase } from "./checks/database";
import type { AppBindings } from "../system/app";

export const healthRoute = new Hono<AppBindings>();

healthRoute.get("/", (c) =>
  c.json({
    service: "studio-cloud-library-registry",
    status: "ok",
    environment: c.env.ENVIRONMENT,
  }),
);

healthRoute.get("/ready", async (c) => {
  const database = await checkDatabase(c.env.REGISTRY_DB);
  return c.json({
    service: "studio-cloud-library-registry",
    status: database.ok ? "ready" : "degraded",
    dependencies: { database },
  });
});

import { Hono } from "hono";
import { ADMISSION_SCOPES } from "../../../admission/scopes.js";
import type { MapBasemap } from "../../../gateway/maps/basemap.js";
import { requireAdmissionScope, type AdmissionEnv } from "../middleware/admission.js";

export function createMapRoutes(basemap: Pick<MapBasemap, "read">): Hono<AdmissionEnv> {
  const routes = new Hono<AdmissionEnv>();
  routes.use("*", requireAdmissionScope(ADMISSION_SCOPES.AGENT_RUN));
  routes.get("/tiles/:z/:x/:y", (context) => respond(basemap, `tiles/${context.req.param("z")}/${context.req.param("x")}/${context.req.param("y")}`));
  routes.get("/glyphs/:range", (context) => respond(basemap, `glyphs/${context.req.param("range")}`));
  return routes;
}

async function respond(basemap: Pick<MapBasemap, "read">, path: string): Promise<Response> {
  const result = await basemap.read(path);
  if (result.kind === "asset") {
    return new Response(new Uint8Array(result.asset.bytes), {
      headers: {
        "Content-Type": result.asset.mimeType,
        "Cache-Control": "private, max-age=600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  return result.kind === "invalid"
    ? Response.json({ error: "That map resource is invalid." }, { status: 400 })
    : Response.json({ error: "The basemap is unavailable." }, { status: 503 });
}

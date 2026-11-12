import { gzipSync } from "node:zlib";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import { createStudioUuid } from "../../src/contracts/uuid.js";
import { MapBasemap } from "../../src/gateway/maps/basemap.js";
import type { HttpRequestOptions } from "../../src/net/http.js";
import { diagnosticRecorder } from "../../src/observability/recorder.js";
import { createAdmissionMiddleware, type AdmissionEnv } from "../../src/transport/http/middleware/admission.js";
import { createMapRoutes } from "../../src/transport/http/routes/maps.js";

const TILE = "application/vnd.mapbox-vector-tile";
const bytes = Buffer.from([0x1a, 0x02, 0x78, 0x02]);

function fixture(request: ConstructorParameters<typeof MapBasemap>[0]) {
  const app = new Hono<AdmissionEnv>();
  const session = createAdmissionSession();
  app.use("*", createAdmissionMiddleware(session.verifier));
  app.route("/api/maps", createMapRoutes(new MapBasemap(request)));
  const get = (path: string, requestId = createStudioUuid()) => app.request(`/api/maps/${path}`, {
    headers: { authorization: `Bearer ${session.credential}`, "X-Project-Studio-Request-Id": requestId },
  });
  return { app, get };
}

afterEach(() => {
  diagnosticRecorder.configure({ enabled: false, captureContent: false, conversations: [] });
  diagnosticRecorder.clear();
});

describe("the reply basemap", () => {
  it("admits only valid tile and glyph ranges and never forwards a caller's URL", async () => {
    const request = vi.fn(async ({ url }: HttpRequestOptions) => ({ url, status: 200, headers: { "content-type": TILE }, bytes }));
    const { app, get } = fixture(request);
    expect((await app.request("/api/maps/tiles/3/4/5.pbf")).status).toBe(401);
    for (const invalid of ["tiles/15/4/5.pbf", "tiles/3/8/5.pbf", "tiles/3/4/-5.pbf", "glyphs/1-256.pbf", "glyphs/65536-65791.pbf"]) {
      expect((await get(invalid)).status).toBe(400);
    }
    expect(request).not.toHaveBeenCalled();
    expect((await get("tiles/3/4/5.pbf?url=http://127.0.0.1/private")).status).toBe(200);
    expect(request).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      url: "https://tiles.openfreemap.org/planet/latest/3/4/5.pbf", maxRedirects: 0, maxBytes: 2 * 1024 * 1024,
    }));
  });

  it("shares concurrent reads, handles compressed assets, and retries only when another request arrives", async () => {
    const request = vi.fn(async ({ url }: HttpRequestOptions) => ({ url, status: 200, headers: { "content-type": TILE }, bytes: gzipSync(bytes) }));
    request.mockImplementationOnce(async ({ url }) => ({ url, status: 503, headers: { "content-type": TILE }, bytes }));
    const { get } = fixture(request);
    expect((await get("tiles/3/4/5.pbf")).status).toBe(503);
    expect(request).toHaveBeenCalledTimes(1);
    const results = await Promise.all([get("tiles/3/4/5.pbf"), get("tiles/03/4/5.pbf")]);
    for (const response of results) {
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(TILE);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    }
    expect((await get("tiles/3/4/5.pbf")).status).toBe(200);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("links the upstream read to admission and records no map data or resource address", async () => {
    diagnosticRecorder.configure({ enabled: true });
    const requestId = createStudioUuid();
    const { get } = fixture(async ({ url }) => ({ url, status: 200, headers: { "content-type": "text/html" }, bytes: Buffer.from("provider error text") }));
    expect((await get("tiles/13/1720/3094.pbf", requestId)).status).toBe(503);
    const events = diagnosticRecorder.read().events;
    const http = events.find((event) => event.name === "http.response" && event.phase === "start");
    const fetch = events.filter((event) => event.name === "map.basemap.fetch");
    expect(fetch).toHaveLength(2);
    expect(fetch[0]).toMatchObject({ identity: { requestId, parentOperationId: http?.identity.operationId }, attributes: { resource: "tile" } });
    expect(fetch[1]?.outcome).toBe("failed");
    expect(JSON.stringify(events)).not.toMatch(/1720|3094|https:\/\/tiles|provider error text/);
  });
});

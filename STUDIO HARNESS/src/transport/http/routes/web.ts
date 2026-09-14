import { Hono } from "hono";

import type { AdmissionEnv } from "../middleware/admission.js";
import type { FaviconSource } from "../../../web/favicons.js";

/**
 * What the window asks the harness about the web on a reader's behalf.
 *
 * One route today: a site's icon, so a search result or a page read can be
 * drawn with the mark its own tab would carry. The window never asks the
 * site; it asks here, and the store behind this answers from disk after
 * the first time (see `web/favicons.ts` for why that is the whole point).
 *
 * A miss is a 404 the window turns into a letter in a disc, and the answer
 * is cached hard on the window's side too: an icon does not change within
 * the life of a conversation, and a reader scrolling back through one must
 * not cost a request per row.
 */
export function createWebRoutes(favicons: FaviconSource): Hono<AdmissionEnv> {
  const routes = new Hono<AdmissionEnv>();

  routes.get("/favicons/:host", async (context) => {
    const icon = await favicons.lookup(context.req.param("host"));
    if (icon === null) {
      return context.json({ error: "No icon for that site.", code: "web.no-icon" }, 404);
    }
    return new Response(new Uint8Array(icon.bytes), {
      status: 200,
      headers: {
        "content-type": icon.mimeType,
        "content-length": String(icon.bytes.byteLength),
        "cache-control": "private, max-age=86400",
      },
    });
  });

  return routes;
}

import * as v from "valibot";
import { StudioError } from "../../contracts/errors.js";
import { MAX_SECRET_LENGTH, type SecureCredentialStore } from "../../credentials/credential-store.js";
import { parseDestination } from "../../net/destination.js";
import { requestDirect } from "../../net/http.js";
import { observeOperation } from "../../observability/operation.js";

const ENDPOINT = "https://api.heigit.org/openrouteservice/v2/directions/foot-walking/geojson";
const KEY = { scope: "provider", id: "openrouteservice" } as const;
const PROVIDER = "openrouteservice";
const SETUP = "Add your openrouteservice key under Settings → Tools → Walking routes.";

export const MAX_WALKING_STOPS = 5;
const MAX_ROUTE_POINTS = 4096;

const longitude = v.pipe(v.number(), v.finite(), v.minValue(-180), v.maxValue(180));
const latitude = v.pipe(v.number(), v.finite(), v.minValue(-85), v.maxValue(85));
export const walkingStopSchema = v.strictObject({
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
  lat: latitude,
  lng: longitude,
});
export type WalkingStop = v.InferOutput<typeof walkingStopSchema>;

const measure = v.pipe(v.number(), v.finite(), v.minValue(0));
const metrics = v.object({ distance: measure, duration: measure });
const providerFeature = v.object({
  geometry: v.object({
    type: v.literal("LineString"),
    coordinates: v.pipe(v.array(v.strictTuple([longitude, latitude])), v.minLength(2), v.maxLength(MAX_ROUTE_POINTS)),
  }),
  properties: v.object({
    summary: metrics,
    segments: v.pipe(v.array(metrics), v.minLength(1), v.maxLength(MAX_WALKING_STOPS - 1)),
  }),
});
const responseSchema = v.object({ features: v.strictTuple([providerFeature]) });

export class WalkingRouteError extends StudioError {
  readonly domain = "network";

  constructor(kind: string, message: string) {
    super(kind, message);
  }
}

function providerError(status: number): WalkingRouteError {
  if (status === 401 || status === 403) return new WalkingRouteError("routing_credential_refused", `The routing service refused the key. ${SETUP}`);
  if (status === 429) return new WalkingRouteError("routing_rate_limited", "The routing provider's request limit was reached. Try again later.");
  if (status === 404 || status === 422) return new WalkingRouteError("routing_no_path", "The routing provider couldn't find a walking path through those stops.");
  return new WalkingRouteError("routing_unavailable", "The routing provider couldn't calculate this walking route.");
}

function unreadable(): WalkingRouteError {
  return new WalkingRouteError("routing_invalid_response", "The routing provider returned incomplete directions.");
}

function readRoute(body: string, stops: readonly WalkingStop[]) {
  let value: unknown;
  try { value = JSON.parse(body); } catch { throw unreadable(); }
  const parsed = v.safeParse(responseSchema, value);
  if (!parsed.success) throw unreadable();
  const feature = parsed.output.features[0];
  const { summary, segments } = feature.properties;
  if (segments.length !== stops.length - 1) throw unreadable();
  return {
    kind: "walking-route" as const,
    version: 1 as const,
    stops,
    coordinates: feature.geometry.coordinates,
    distanceMeters: summary.distance,
    durationSeconds: summary.duration,
    legs: segments.map(({ distance, duration }) => ({ distanceMeters: distance, durationSeconds: duration })),
  };
}

export function walkingRouteHost(): string {
  return parseDestination(ENDPOINT).host;
}

export class WalkingRoutes {
  constructor(
    private readonly credentials: SecureCredentialStore,
    private readonly request: typeof requestDirect = requestDirect,
  ) {}

  async hasKey(): Promise<boolean> {
    return Boolean(await this.credentials.get(KEY));
  }

  async setKey(value: string): Promise<void> {
    const key = value.trim();
    if (key.length > MAX_SECRET_LENGTH || !/^[A-Za-z0-9._~+/=-]+$/.test(key)) {
      throw new WalkingRouteError("routing_invalid_key", "Enter a valid openrouteservice API key.");
    }
    await this.credentials.set(KEY, key);
  }

  async clearKey(): Promise<void> {
    await this.credentials.delete(KEY);
  }

  async route(stops: readonly WalkingStop[], signal: AbortSignal | undefined) {
    const key = await this.credentials.get(KEY);
    if (!key) throw new WalkingRouteError("routing_not_configured", SETUP);
    return observeOperation("provider", "map.routing.fetch", async () => {
      let response;
      try {
        response = await this.request({
          url: ENDPOINT,
          author: "model",
          method: "POST",
          ...(signal === undefined ? {} : { signal }),
          maxRedirects: 0,
          timeoutMs: 15_000,
          maxBytes: 1024 * 1024,
          headers: { authorization: key, "content-type": "application/json", accept: "application/geo+json" },
          // ORS omits the entire segments array when instructions are off.
          // Keep the leg measurements and leave the instructions out of our result.
          body: JSON.stringify({ coordinates: stops.map(({ lng, lat }) => [lng, lat]), instructions: true }),
        });
      } catch {
        if (signal?.aborted) throw signal.reason;
        throw new WalkingRouteError("routing_unavailable", "The routing provider did not answer. Try again later.");
      }
      if (response.status !== 200) throw providerError(response.status);
      return readRoute(response.body, stops);
    }, { provider: PROVIDER, mode: "walking" });
  }
}

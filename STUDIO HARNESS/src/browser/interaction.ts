import * as v from "valibot";

const coordinate = v.pipe(v.number(), v.minValue(0), v.maxValue(1));
const viewer = { viewerId: v.pipe(v.string(), v.uuid()) };
const tab = { tabId: v.pipe(v.string(), v.maxLength(100)) };
const size = v.pipe(v.number(), v.integer(), v.minValue(320), v.maxValue(2560));

/** Private human-control protocol; these commands are never model tools. */
export const browserInteractionSchema = v.variant("action", [
  v.strictObject({ action: v.literal("view"), ...viewer, since: v.optional(v.number()) }),
  v.strictObject({ action: v.literal("claim"), ...viewer }),
  v.strictObject({ action: v.literal("release"), ...viewer }),
  v.strictObject({ action: v.literal("detach"), ...viewer }),
  v.strictObject({ action: v.literal("select"), ...viewer, ...tab }),
  v.strictObject({ action: v.literal("close"), ...viewer, ...tab }),
  v.strictObject({ action: v.literal("new"), ...viewer }),
  v.strictObject({ action: v.literal("reset"), ...viewer }),
  v.strictObject({ action: v.literal("navigate"), ...viewer, ...tab,
    url: v.pipe(v.string(), v.maxLength(8192), v.url(), v.check((url) => /^https?:\/\//i.test(url))) }),
  v.strictObject({ action: v.literal("back"), ...viewer, ...tab }),
  v.strictObject({ action: v.literal("forward"), ...viewer, ...tab }),
  v.strictObject({ action: v.literal("reload"), ...viewer, ...tab }),
  v.strictObject({ action: v.literal("resize"), ...viewer, ...tab, width: size, height: size }),
  v.strictObject({ action: v.literal("pointer"), ...viewer, ...tab,
    kind: v.picklist(["move", "down", "up"]), x: coordinate, y: coordinate,
    button: v.picklist(["left", "middle", "right"]), clicks: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(3)) }),
  v.strictObject({ action: v.literal("wheel"), ...viewer, ...tab,
    x: v.pipe(v.number(), v.minValue(-4000), v.maxValue(4000)),
    y: v.pipe(v.number(), v.minValue(-4000), v.maxValue(4000)) }),
  v.strictObject({ action: v.literal("key"), ...viewer, ...tab,
    kind: v.picklist(["down", "up"]), key: v.pipe(v.string(), v.minLength(1), v.maxLength(100)) }),
  v.strictObject({ action: v.literal("text"), ...viewer, ...tab,
    text: v.pipe(v.string(), v.maxLength(16384)) }),
]);

export type BrowserInteraction = v.InferOutput<typeof browserInteractionSchema>;

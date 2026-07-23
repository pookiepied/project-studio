import * as v from "valibot";

export const modelSourceSchema = v.picklist([
  "local",
  "studio-cloud",
  "test",
]);

export type ModelSource = v.InferOutput<typeof modelSourceSchema>;

export const modelReferenceSchema = v.object({
  source: modelSourceSchema,
  provider: v.pipe(v.string(), v.minLength(1)),
  model: v.pipe(v.string(), v.minLength(1)),
});

export type ModelReference = v.InferOutput<typeof modelReferenceSchema>;

export interface ModelProviderPort {
  resolve(reference: ModelReference): string;
}

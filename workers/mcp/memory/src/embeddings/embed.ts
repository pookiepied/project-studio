import type { Env } from "../env";

export async function embedText(env: Env, text: string): Promise<number[]> {
  const result = await (env.AI as any).run(env.EMBED_MODEL, { text: [text] });
  return result.data[0] as number[];
}

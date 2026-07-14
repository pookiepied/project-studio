import type { Env } from "../env";
import type { Category } from "./types";
import { queryVectors } from "../embeddings/vectorize";

const DEFAULT_SIMILARITY_THRESHOLD = 0.92;

export interface DuplicateMatch {
  factId: string;
  score: number;
}

/**
 * Searches for an existing fact with high semantic similarity to the given
 * embedding, scoped to the same user and category.
 *
 * Returns the matching fact's ID and similarity score if a duplicate is found
 * above the threshold, or null if the fact is novel.
 */
export async function findSimilarFact(
  env: Env,
  embedding: number[],
  userId: string,
  category: Category,
  threshold = DEFAULT_SIMILARITY_THRESHOLD
): Promise<DuplicateMatch | null> {
  const matches = await queryVectors(env, embedding, userId, 10);

  const match = matches.find(
    (m) =>
      m.metadata.type === "fact" &&
      m.metadata.category === category &&
      m.score >= threshold
  );

  if (!match) return null;
  return {
    factId: match.metadata.source_id as string,
    score:  match.score,
  };
}

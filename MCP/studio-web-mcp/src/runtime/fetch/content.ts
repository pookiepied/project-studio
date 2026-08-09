import type { NormalizedFetchResponse } from "../../providers/fetch/types.js";

export interface BoundedContent {
  content: string;
  truncated: boolean;
  has_more: boolean;
  next_offset?: number;
  returned: number;
  total_estimated: number;
}

export function boundContent(full: string, offset: number, maxChars: number): BoundedContent {
  const total = full.length;
  const slice = full.slice(offset, offset + maxChars);
  const has_more = offset + maxChars < total;
  return {
    content: slice,
    truncated: has_more,
    has_more,
    next_offset: has_more ? offset + maxChars : undefined,
    returned: slice.length,
    total_estimated: total,
  };
}

export function applyBounds(
  res: NormalizedFetchResponse,
  offset: number,
  maxChars: number,
): NormalizedFetchResponse & { metadata: { offset: number; returned: number; total_estimated: number; has_more: boolean; next_offset?: number | undefined } } {
  const bounded = boundContent(res.content, offset, maxChars);
  return {
    ...res,
    content: bounded.content,
    truncated: bounded.truncated,
    offset,
    has_more: bounded.has_more,
    next_offset: bounded.next_offset,
    metadata: {
      offset,
      returned: bounded.returned,
      total_estimated: bounded.total_estimated,
      has_more: bounded.has_more,
      next_offset: bounded.next_offset,
    },
  } as NormalizedFetchResponse & { metadata: { offset: number; returned: number; total_estimated: number; has_more: boolean; next_offset?: number | undefined } };
}

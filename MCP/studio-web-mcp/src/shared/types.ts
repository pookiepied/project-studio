export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface PaginatedResponse<T> {
  content: T;
  has_more: boolean;
  next_offset?: number;
  total_estimated: number;
}

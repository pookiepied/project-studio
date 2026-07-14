import type { Env as ApiEnv } from '../types';
import type { Caller } from '../types';

export type Env = ApiEnv;

export interface Variables {
  requestId: string;
  caller: Caller;
}

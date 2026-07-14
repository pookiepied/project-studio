import type { Logger } from "./logging";
import type { Env } from "./env";

export type AppBindings = {
  Bindings: Env;
  Variables: {
    logger: Logger;
    requestId: string;
    userId?: string;
  };
};

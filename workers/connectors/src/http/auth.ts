import { connectorError } from "../errors";
import { userIdFromRequest } from "./request";

export function requireUser(request: Request): string {
  const userId = userIdFromRequest(request);
  if (!userId) throw connectorError("bad_request", "Missing x-user-id header");
  return userId;
}

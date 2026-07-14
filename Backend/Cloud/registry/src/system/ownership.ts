import { badRequest } from "../errors/appError";
import { oneOf, optionalString } from "./validation";

export type ResourceOwnerType = "system" | "user";

export interface ResourceOwner {
  ownerType: ResourceOwnerType;
  ownerUserId?: string;
  ownerKey: string;
}

export function systemOwner(): ResourceOwner {
  return { ownerType: "system", ownerKey: "system" };
}

export function userOwner(userId: string): ResourceOwner {
  return { ownerType: "user", ownerUserId: userId, ownerKey: `user:${userId}` };
}

export function readableOwnerKeys(userId: string): [string, string] {
  return ["system", `user:${userId}`];
}

export function readOwner(input: Record<string, unknown>, options: { allowUserOwned?: boolean } = {}): ResourceOwner {
  const ownerType = input.ownerType === undefined ? "system" : oneOf(input.ownerType, ["system", "user"] as const, "ownerType");
  const ownerUserId = optionalString(input.ownerUserId, "ownerUserId");

  if (ownerType === "system") return systemOwner();
  if (!options.allowUserOwned) throw badRequest("User-owned registry resources are not enabled yet.");
  if (!ownerUserId) throw badRequest("ownerUserId is required when ownerType is user.");
  return userOwner(ownerUserId);
}

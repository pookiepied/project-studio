import { Capability } from "@/domain/models/capabilities";
import { GatewayError } from "@/platform/errors";
import { getModel } from "./index";

export function requireModel(requestedModel: string, capability?: Capability) {
  const model = getModel(requestedModel);
  if (!model) {
    throw new GatewayError("MODEL_NOT_FOUND", `Model ${requestedModel} is not registered with the gateway.`);
  }
  if (capability && !model.capabilities.modalities.includes(capability)) {
    throw new GatewayError("CAPABILITY_NOT_SUPPORTED", `Model ${model.id} does not support ${capability}.`);
  }
  return model;
}

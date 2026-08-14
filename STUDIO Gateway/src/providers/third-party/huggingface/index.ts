import { makeThirdPartyProvider } from "../factory.ts";
import { capabilitiesForOpenAICompatible } from "../../capabilities.ts";

export const huggingfaceProvider = makeThirdPartyProvider("huggingface");
export const huggingfaceCapabilities = capabilitiesForOpenAICompatible("huggingface");

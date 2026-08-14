import { makeThirdPartyProvider } from "../factory.ts";
import { capabilitiesForOpenAICompatible } from "../../capabilities.ts";

export const cohereProvider = makeThirdPartyProvider("cohere");
export const cohereCapabilities = capabilitiesForOpenAICompatible("cohere");

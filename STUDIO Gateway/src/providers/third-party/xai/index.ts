import { makeThirdPartyProvider } from "../factory.ts";
import { capabilitiesForOpenAICompatible } from "../../capabilities.ts";

export const xaiProvider = makeThirdPartyProvider("xai");
export const xaiCapabilities = capabilitiesForOpenAICompatible("xai");

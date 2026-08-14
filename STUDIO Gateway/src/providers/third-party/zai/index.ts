import { makeThirdPartyProvider } from "../factory.ts";
import { capabilitiesForOpenAICompatible } from "../../capabilities.ts";

export const zaiProvider = makeThirdPartyProvider("zai");
export const zaiCapabilities = capabilitiesForOpenAICompatible("zai");

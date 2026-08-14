import { makeThirdPartyProvider } from "../factory.ts";
import { capabilitiesForOpenAICompatible } from "../../capabilities.ts";

export const togetherProvider = makeThirdPartyProvider("together");
export const togetherCapabilities = capabilitiesForOpenAICompatible("together");

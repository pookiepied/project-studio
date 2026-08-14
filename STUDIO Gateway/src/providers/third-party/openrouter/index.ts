import { makeThirdPartyProvider } from "../factory.ts";
import { capabilitiesForOpenAICompatible } from "../../capabilities.ts";

export const openrouterProvider = makeThirdPartyProvider("openrouter");
export const openrouterCapabilities = capabilitiesForOpenAICompatible("openrouter");

import { makeThirdPartyProvider } from "../factory.ts";
import { capabilitiesForOpenAICompatible } from "../../capabilities.ts";

export const fireworksProvider = makeThirdPartyProvider("fireworks");
export const fireworksCapabilities = capabilitiesForOpenAICompatible("fireworks");

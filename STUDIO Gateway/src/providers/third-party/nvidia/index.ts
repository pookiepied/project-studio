import { makeThirdPartyProvider } from "../factory.ts";
import { capabilitiesForOpenAICompatible } from "../../capabilities.ts";

export const nvidiaProvider = makeThirdPartyProvider("nvidia");
export const nvidiaCapabilities = capabilitiesForOpenAICompatible("nvidia");

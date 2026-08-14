import { makeThirdPartyProvider } from "../factory.ts";
import { capabilitiesForOpenAICompatible } from "../../capabilities.ts";

export const deepseekProvider = makeThirdPartyProvider("deepseek");
export const deepseekCapabilities = capabilitiesForOpenAICompatible("deepseek");

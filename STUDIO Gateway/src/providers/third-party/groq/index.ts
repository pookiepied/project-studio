import { makeThirdPartyProvider } from "../factory.ts";
import { capabilitiesForOpenAICompatible } from "../../capabilities.ts";

export const groqProvider = makeThirdPartyProvider("groq");
export const groqCapabilities = capabilitiesForOpenAICompatible("groq");

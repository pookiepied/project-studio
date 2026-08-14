import { makeThirdPartyProvider } from "../factory.ts";
import { capabilitiesForOpenAICompatible } from "../../capabilities.ts";

export const mistralProvider = makeThirdPartyProvider("mistral");
export const mistralCapabilities = capabilitiesForOpenAICompatible("mistral");

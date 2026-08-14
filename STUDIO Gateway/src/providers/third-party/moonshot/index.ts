import { makeThirdPartyProvider } from "../factory.ts";
import { capabilitiesForOpenAICompatible } from "../../capabilities.ts";

export const moonshotProvider = makeThirdPartyProvider("moonshot");
export const moonshotCapabilities = capabilitiesForOpenAICompatible("moonshot");

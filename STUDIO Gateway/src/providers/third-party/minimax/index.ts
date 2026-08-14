import { makeThirdPartyProvider } from "../factory.ts";
import { capabilitiesForOpenAICompatible } from "../../capabilities.ts";

export const minimaxProvider = makeThirdPartyProvider("minimax");
export const minimaxCapabilities = capabilitiesForOpenAICompatible("minimax");

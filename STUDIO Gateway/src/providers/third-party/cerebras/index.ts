import { makeThirdPartyProvider } from "../factory.ts";
import { capabilitiesForOpenAICompatible } from "../../capabilities.ts";

export const cerebrasProvider = makeThirdPartyProvider("cerebras");
export const cerebrasCapabilities = capabilitiesForOpenAICompatible("cerebras");

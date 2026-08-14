import { makeThirdPartyProvider } from "../factory.ts";
import { capabilitiesForOpenAICompatible } from "../../capabilities.ts";

export const xiaomiProvider = makeThirdPartyProvider("xiaomi");
export const xiaomiCapabilities = capabilitiesForOpenAICompatible("xiaomi");

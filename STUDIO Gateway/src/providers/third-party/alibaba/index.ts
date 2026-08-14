import { makeThirdPartyProvider } from "../factory.ts";
import { capabilitiesForOpenAICompatible } from "../../capabilities.ts";

export const alibabaProvider = makeThirdPartyProvider("alibaba");
export const alibabaCapabilities = capabilitiesForOpenAICompatible("alibaba");

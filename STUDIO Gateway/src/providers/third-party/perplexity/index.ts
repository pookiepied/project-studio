import { makeThirdPartyProvider } from "../factory.ts";
import { capabilitiesForOpenAICompatible } from "../../capabilities.ts";

export const perplexityProvider = makeThirdPartyProvider("perplexity");
export const perplexityCapabilities = capabilitiesForOpenAICompatible("perplexity");

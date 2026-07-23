import { alibabaProvider } from "./alibaba";
import { anthropicProvider } from "./anthropic";
import { deepseekProvider } from "./deepseek";
import { elevenlabsProvider } from "./elevenlabs";
import { falProvider } from "./fal";
import { googleProvider } from "./google";
import { groqProvider } from "./groq";
import { minimaxProvider } from "./minimax";
import { mistralProvider } from "./mistral";
import { openaiProvider } from "./openai";
import { openrouterProvider } from "./openrouter";
import { replicateProvider } from "./replicate";
import type { ProviderModule } from "./types";
import { xaiProvider } from "./xai";
import { xiaomiProvider } from "./xiaomi";
import { zaiProvider } from "./zai";

export const providers: ProviderModule[] = [
  openaiProvider,
  googleProvider,
  anthropicProvider,
  groqProvider,
  xaiProvider,
  deepseekProvider,
  mistralProvider,
  falProvider,
  replicateProvider,
  elevenlabsProvider,
  openrouterProvider,
  alibabaProvider,
  minimaxProvider,
  zaiProvider,
  xiaomiProvider
];

export function getProvider(providerId: string): ProviderModule | undefined {
  return providers.find((provider) => provider.id === providerId);
}

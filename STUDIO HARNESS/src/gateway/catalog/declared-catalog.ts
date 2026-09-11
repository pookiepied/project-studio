import type { InvocationShape, ProviderKind } from "../../contracts/providers.js";
import type { ModelCapability, ReasoningLevel } from "../../contracts/models.js";

/**
 * The third catalog source: the models Project Studio declares itself.
 *
 * Pi's catalogs cover language (35 providers) and images (OpenRouter only)
 * and have nothing at all for video, speech, transcription, web search, or
 * web fetch. Rather than leave those capability slots permanently empty, this
 * file declares the models Studio knows how to name, under the provider that
 * serves them. It is a maintained data file, not a live feed: entries are
 * added from the vendor's own documented API, and a model the vendor retires
 * is removed here.
 *
 * Entries are matched to a connection by `catalogProvider` and `kind`, the
 * same keying Pi's own catalogs use - one OpenAI account is one connection,
 * and its chat models (Pi's) arrive beside its speech and image models (this
 * file's), each tagged with what it can do.
 *
 * Every entry states `textGeneration: "unsupported"` on purpose: none of
 * these models answers chat, and saying so is what keeps them out of the
 * composer while their own slot - transcription, speech, images, embeddings,
 * video, search, fetch - finds them. A model's unstated dimensions stay
 * unknown rather than unsupported; this line is stated, not defaulted.
 */

export interface DeclaredModel {
  readonly id: string;
  readonly displayName: string;
  /** Only the states this model earns; everything else stays honestly unknown. */
  readonly capability: Partial<Omit<ModelCapability, "contextWindow" | "maxOutputTokens">>;
  readonly shape: InvocationShape;
  readonly contextWindow?: number;
  readonly reasoningLevels?: readonly ReasoningLevel[];
}

export interface DeclaredProvider {
  /** The `catalogProvider` value a connection carries to draw this catalog. */
  readonly id: string;
  readonly displayName: string;
  readonly kind: ProviderKind;
  readonly protocol: string;
  /** The provider's own endpoint, when one address serves every model. */
  readonly baseUrl: string | undefined;
  readonly models: readonly DeclaredModel[];
}

const NOT_CHAT = { textGeneration: "unsupported" } as const;

export const DECLARED_PROVIDERS: readonly DeclaredProvider[] = [
  {
    id: "openai",
    displayName: "OpenAI",
    kind: "language",
    protocol: "openai-completions",
    baseUrl: "https://api.openai.com/v1",
    models: [
      {
        id: "gpt-image-1",
        displayName: "GPT Image 1",
        capability: {
          ...NOT_CHAT,
          imageGeneration: "supported",
          imageEditing: "supported",
          vision: "supported",
        },
        shape: "sync",
      },
      {
        id: "dall-e-3",
        displayName: "DALL-E 3",
        capability: { ...NOT_CHAT, imageGeneration: "supported" },
        shape: "sync",
      },
      {
        id: "whisper-1",
        displayName: "Whisper",
        capability: { ...NOT_CHAT, transcription: "supported" },
        shape: "sync",
      },
      {
        id: "gpt-4o-mini-transcribe",
        displayName: "GPT-4o Mini Transcribe",
        capability: { ...NOT_CHAT, transcription: "supported" },
        shape: "sync",
      },
      {
        id: "gpt-4o-mini-tts",
        displayName: "GPT-4o Mini TTS",
        capability: { ...NOT_CHAT, speechGeneration: "supported" },
        shape: "sync",
      },
      {
        id: "tts-1",
        displayName: "TTS-1",
        capability: { ...NOT_CHAT, speechGeneration: "supported" },
        shape: "sync",
      },
      {
        id: "tts-1-hd",
        displayName: "TTS-1 HD",
        capability: { ...NOT_CHAT, speechGeneration: "supported" },
        shape: "sync",
      },
      {
        id: "text-embedding-3-small",
        displayName: "Text Embedding 3 Small",
        capability: { ...NOT_CHAT, embeddings: "supported" },
        shape: "sync",
      },
      {
        id: "text-embedding-3-large",
        displayName: "Text Embedding 3 Large",
        capability: { ...NOT_CHAT, embeddings: "supported" },
        shape: "sync",
      },
    ],
  },
  {
    id: "google",
    displayName: "Google",
    kind: "language",
    protocol: "google-generative-ai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    models: [
      {
        id: "veo-3.0-generate-001",
        displayName: "Veo 3",
        capability: { ...NOT_CHAT, videoGeneration: "supported" },
        // Long-running operation: the request returns a name to poll, not a video.
        shape: "poll",
      },
      {
        id: "veo-3.0-fast-generate-001",
        displayName: "Veo 3 Fast",
        capability: { ...NOT_CHAT, videoGeneration: "supported" },
        shape: "poll",
      },
      {
        id: "gemini-embedding-001",
        displayName: "Gemini Embedding",
        capability: { ...NOT_CHAT, embeddings: "supported" },
        shape: "sync",
      },
    ],
  },
  {
    id: "elevenlabs",
    displayName: "ElevenLabs",
    kind: "media",
    protocol: "elevenlabs",
    baseUrl: "https://api.elevenlabs.io/v1",
    models: [
      {
        id: "eleven_multilingual_v2",
        displayName: "Eleven Multilingual v2",
        capability: { ...NOT_CHAT, speechGeneration: "supported" },
        shape: "sync",
      },
      {
        id: "eleven_turbo_v2_5",
        displayName: "Eleven Turbo v2.5",
        capability: { ...NOT_CHAT, speechGeneration: "supported" },
        shape: "sync",
      },
      {
        id: "scribe_v1",
        displayName: "Scribe",
        capability: { ...NOT_CHAT, transcription: "supported" },
        shape: "sync",
      },
    ],
  },
  {
    id: "tavily",
    displayName: "Tavily",
    kind: "retrieval",
    protocol: "tavily",
    baseUrl: "https://api.tavily.com",
    models: [
      {
        id: "tavily-search",
        displayName: "Tavily Search",
        capability: { ...NOT_CHAT, webSearch: "supported" },
        shape: "sync",
      },
      {
        id: "tavily-extract",
        displayName: "Tavily Extract",
        capability: { ...NOT_CHAT, webFetch: "supported" },
        shape: "sync",
      },
    ],
  },
  {
    id: "brave",
    displayName: "Brave Search",
    kind: "retrieval",
    protocol: "brave",
    baseUrl: "https://api.search.brave.com/res/v1",
    models: [
      {
        id: "brave-search",
        displayName: "Brave Search",
        capability: { ...NOT_CHAT, webSearch: "supported" },
        shape: "sync",
      },
    ],
  },
  {
    id: "exa",
    displayName: "Exa",
    kind: "retrieval",
    protocol: "exa",
    baseUrl: "https://api.exa.ai",
    models: [
      {
        id: "exa-search",
        displayName: "Exa Search",
        capability: { ...NOT_CHAT, webSearch: "supported" },
        shape: "sync",
      },
    ],
  },
  {
    id: "jina",
    displayName: "Jina",
    kind: "retrieval",
    protocol: "jina",
    baseUrl: "https://r.jina.ai",
    models: [
      {
        id: "jina-reader",
        displayName: "Jina Reader",
        capability: { ...NOT_CHAT, webFetch: "supported" },
        shape: "sync",
      },
      {
        id: "jina-search",
        displayName: "Jina Search",
        capability: { ...NOT_CHAT, webSearch: "supported" },
        shape: "sync",
      },
    ],
  },
  {
    id: "firecrawl",
    displayName: "Firecrawl",
    kind: "retrieval",
    protocol: "firecrawl",
    baseUrl: "https://api.firecrawl.dev/v1",
    models: [
      {
        id: "firecrawl-scrape",
        displayName: "Firecrawl Scrape",
        capability: { ...NOT_CHAT, webFetch: "supported" },
        shape: "sync",
      },
    ],
  },
];

export function declaredProviderFor(providerId: string): DeclaredProvider | undefined {
  return DECLARED_PROVIDERS.find((provider) => provider.id === providerId);
}

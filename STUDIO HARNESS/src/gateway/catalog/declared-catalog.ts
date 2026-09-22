import type { CapabilitySlot, InvocationShape, ProviderKind } from "../../contracts/providers.js";
import type { ModelCapability, ReasoningLevel } from "../../contracts/models.js";

/**
 * The declared catalog: the models Project Studio names itself.
 *
 * The language gateway's catalog covers chat and nothing else. Everything
 * past text - images, video, speech, transcription, embeddings, web search
 * and web fetch - is declared here, under the vendor that serves it, from
 * the vendor's own documented API. It is a maintained data file, not a live
 * feed: a model the vendor retires is removed here, and the dates in the
 * comments say when. Checked against the vendors' documentation on
 * 2026-09-11; the gateway plan replaces the OpenRouter and FAL entries with
 * live listings when their adapters land.
 *
 * Entries are matched to a connection by `catalogProvider`, and each model
 * reaches the connection only if it serves the model's kind - one OpenAI
 * account is one connection, and its chat models (the language gateway's)
 * arrive beside its speech and image models (this file's), each tagged with
 * what it can do.
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
  /**
   * Whether this is one of the few the featured shelf recommends for what it
   * does, rather than a member of the catalogue. Untouched by the live
   * listing that may also carry the same id: where both speak, the declared
   * recommendation rides the joined row.
   */
  readonly featured?: boolean;
}

export interface DeclaredProvider {
  /** The `catalogProvider` value a connection carries to draw this catalog. */
  readonly id: string;
  readonly displayName: string;
  /**
   * The kinds one key to this vendor serves, and the wire for each, as plain
   * strings the library parses against the contract's unions. A language
   * wire named here is a fallback: when the language gateway's catalog
   * knows the vendor, its majority protocol wins.
   */
  readonly serves: Partial<Record<ProviderKind, string>>;
  /** The provider's own endpoint, when one address serves every model. */
  readonly baseUrl: string | undefined;
  readonly models: readonly DeclaredModel[];
  /**
   * The slots this vendor serves whose models are read live rather than
   * declared, so the library can say what a connection will offer before
   * the listing has been fetched.
   */
  readonly liveCapabilities?: readonly CapabilitySlot[];
}

const NOT_CHAT = { textGeneration: "unsupported" } as const;

export const DECLARED_PROVIDERS: readonly DeclaredProvider[] = [
  {
    id: "openai",
    displayName: "OpenAI",
    serves: { language: "openai-responses", media: "openai" },
    baseUrl: "https://api.openai.com/v1",
    models: [
      // The GPT Image family. gpt-image-1 shuts down on 2026-10-23 and
      // gpt-image-1-mini and -1.5 on 2026-12-01, all replaced by gpt-image-2;
      // dall-e-2 and -3 were removed on 2026-05-12. Every model returns
      // base64 only, and every one accepts input images on the edits
      // endpoint, which is what earns imageEditing.
      {
        id: "gpt-image-2",
        displayName: "GPT Image 2",
        capability: {
          ...NOT_CHAT,
          imageGeneration: "supported",
          imageEditing: "supported",
          vision: "supported",
        },
        shape: "sync",
      },
      {
        id: "gpt-image-2.5-sunburst",
        displayName: "GPT Image 2.5 Sunburst",
        capability: {
          ...NOT_CHAT,
          imageGeneration: "supported",
          imageEditing: "supported",
          vision: "supported",
        },
        shape: "sync",
      },
      {
        id: "gpt-image-2.5-flare",
        displayName: "GPT Image 2.5 Flare",
        capability: {
          ...NOT_CHAT,
          imageGeneration: "supported",
          imageEditing: "supported",
          vision: "supported",
        },
        shape: "sync",
      },
      // Transcription. whisper-1 and the gpt-4o-*-transcribe ids are
      // deprecated for removal on 2027-02-26; gpt-transcribe is the vendor's
      // recommended replacement and returns text without segments.
      // gpt-4o-transcribe-diarize is the one with speaker labels.
      {
        id: "gpt-transcribe",
        displayName: "GPT Transcribe",
        capability: { ...NOT_CHAT, transcription: "supported" },
        shape: "sync",
      },
      {
        id: "gpt-4o-transcribe-diarize",
        displayName: "GPT-4o Transcribe (speakers)",
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
        id: "whisper-1",
        displayName: "Whisper",
        capability: { ...NOT_CHAT, transcription: "supported" },
        shape: "sync",
      },
      // Speech. None of these is on the deprecation list; gpt-4o-mini-tts
      // takes style instructions, the tts-1 pair does not.
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
    id: "openrouter",
    displayName: "OpenRouter",
    // OpenRouter serves speech, transcription, documents, images and video
    // on the chat key. Its models are not declared here: the listing is
    // live, moves weekly, and `openrouter-media.ts` reads it from
    // OpenRouter's own endpoints for a connection that serves the wire.
    serves: { language: "openai-completions", media: "openrouter" },
    baseUrl: "https://openrouter.ai/api/v1",
    models: [],
    liveCapabilities: [
      "imageGeneration",
      "imageEditing",
      "videoGeneration",
      "speechGeneration",
      "transcription",
      "documentReading",
    ],
  },
  {
    id: "mistral",
    displayName: "Mistral",
    // The chat models are Pi's; what is declared is the Document AI OCR
    // processor, one alias the vendor keeps pointed at its newest OCR
    // model, checked against docs.mistral.ai on 2026-09-22. It reads PDFs,
    // Office files and pictures of pages, scanned or not, and is the one
    // model here that is OCR and nothing else.
    serves: { language: "mistral-conversations", media: "mistral" },
    baseUrl: "https://api.mistral.ai/v1",
    models: [
      {
        id: "mistral-ocr-latest",
        displayName: "Mistral OCR",
        capability: { ...NOT_CHAT, documentReading: "supported" },
        shape: "sync",
        featured: true,
      },
    ],
  },
  {
    id: "google",
    displayName: "Google",
    serves: { language: "google-generative-ai", media: "google" },
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    models: [
      // Images. The Imagen family shut down on 2026-08-17; the Gemini image
      // models on the Interactions API replace it, and every one takes input
      // images, which earns imageEditing.
      {
        id: "gemini-3.1-flash-image",
        displayName: "Gemini 3.1 Flash Image",
        capability: {
          ...NOT_CHAT,
          imageGeneration: "supported",
          imageEditing: "supported",
          vision: "supported",
        },
        shape: "sync",
      },
      {
        id: "gemini-3.1-flash-lite-image",
        displayName: "Gemini 3.1 Flash Lite Image",
        capability: {
          ...NOT_CHAT,
          imageGeneration: "supported",
          imageEditing: "supported",
          vision: "supported",
        },
        shape: "sync",
      },
      {
        id: "gemini-3-pro-image",
        displayName: "Gemini 3 Pro Image",
        capability: {
          ...NOT_CHAT,
          imageGeneration: "supported",
          imageEditing: "supported",
          vision: "supported",
        },
        shape: "sync",
      },
      // Video. veo-3.0 is deprecated; 3.1 is current. Long-running
      // operation: the request returns a name to poll, not a video.
      {
        id: "veo-3.1-generate-preview",
        displayName: "Veo 3.1",
        capability: { ...NOT_CHAT, videoGeneration: "supported" },
        shape: "poll",
      },
      {
        id: "veo-3.1-fast-generate-preview",
        displayName: "Veo 3.1 Fast",
        capability: { ...NOT_CHAT, videoGeneration: "supported" },
        shape: "poll",
      },
      {
        id: "veo-3.1-lite-generate-preview",
        displayName: "Veo 3.1 Lite",
        capability: { ...NOT_CHAT, videoGeneration: "supported" },
        shape: "poll",
      },
      {
        id: "gemini-3.1-flash-tts-preview",
        displayName: "Gemini 3.1 Flash TTS",
        capability: { ...NOT_CHAT, speechGeneration: "supported" },
        shape: "sync",
      },
      {
        id: "gemini-3.5-transcribe",
        displayName: "Gemini 3.5 Transcribe",
        capability: { ...NOT_CHAT, transcription: "supported" },
        shape: "sync",
      },
      {
        id: "gemini-embedding-2",
        displayName: "Gemini Embedding 2",
        capability: { ...NOT_CHAT, embeddings: "supported" },
        shape: "sync",
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
    id: "fal",
    displayName: "FAL",
    // The queue host is the base URL; a model id is the path, so every id
    // here is also the endpoint a generation drives. The catalogue itself is
    // read live (`fal-media.ts`; 1500 models, 990 in slots Studio answers,
    // the day this landed) and what is declared here is the featured shelf:
    // the research's picks. Where FAL splits one model across a
    // text-to-image and an image-to-image endpoint, both are featured,
    // because the editing slot recommends what the generation slot cannot;
    // the video trio are the text-to-video endpoints, whose image-to-video
    // siblings share their slot and add no second opinion. Every one is a
    // job.
    serves: { media: "fal" },
    baseUrl: "https://queue.fal.run",
    models: [
      {
        id: "fal-ai/flux-2-pro",
        displayName: "FLUX.2 Pro",
        capability: { ...NOT_CHAT, imageGeneration: "supported" },
        shape: "poll",
        featured: true,
      },
      {
        id: "fal-ai/flux-2-pro/edit",
        displayName: "FLUX.2 Pro (edit)",
        capability: { ...NOT_CHAT, imageGeneration: "supported", imageEditing: "supported", vision: "supported" },
        shape: "poll",
        featured: true,
      },
      {
        id: "fal-ai/nano-banana-2",
        displayName: "Nano Banana 2",
        capability: { ...NOT_CHAT, imageGeneration: "supported" },
        shape: "poll",
        featured: true,
      },
      {
        id: "fal-ai/nano-banana-2/edit",
        displayName: "Nano Banana 2 (edit)",
        capability: { ...NOT_CHAT, imageGeneration: "supported", imageEditing: "supported", vision: "supported" },
        shape: "poll",
        featured: true,
      },
      {
        id: "bytedance/seedream/v5/pro/text-to-image",
        displayName: "Seedream 5.0 Pro",
        capability: { ...NOT_CHAT, imageGeneration: "supported" },
        shape: "poll",
        featured: true,
      },
      {
        id: "bytedance/seedream/v5/pro/edit",
        displayName: "Seedream 5.0 Pro (edit)",
        capability: { ...NOT_CHAT, imageGeneration: "supported", imageEditing: "supported", vision: "supported" },
        shape: "poll",
        featured: true,
      },
      {
        id: "alibaba/qwen-image-3/text-to-image",
        displayName: "Qwen Image 3",
        capability: { ...NOT_CHAT, imageGeneration: "supported" },
        shape: "poll",
        featured: true,
      },
      {
        id: "alibaba/qwen-image-3/edit",
        displayName: "Qwen Image 3 (edit)",
        capability: { ...NOT_CHAT, imageGeneration: "supported", imageEditing: "supported", vision: "supported" },
        shape: "poll",
        featured: true,
      },
      {
        id: "alibaba/wan-3.0/text-to-video",
        displayName: "Wan 3.0",
        capability: { ...NOT_CHAT, videoGeneration: "supported" },
        shape: "poll",
        featured: true,
      },
      {
        id: "minimax/h3/text-to-video",
        displayName: "MiniMax H3",
        capability: { ...NOT_CHAT, videoGeneration: "supported" },
        shape: "poll",
        featured: true,
      },
      {
        id: "bytedance/seedance-2.5/text-to-video",
        displayName: "Seedance 2.5",
        capability: { ...NOT_CHAT, videoGeneration: "supported" },
        shape: "poll",
        featured: true,
      },
    ],
  },
  {
    id: "deepgram",
    displayName: "Deepgram",
    serves: { media: "deepgram" },
    baseUrl: "https://api.deepgram.com/v1",
    models: [
      {
        id: "nova-3",
        displayName: "Nova 3",
        capability: { ...NOT_CHAT, transcription: "supported" },
        shape: "sync",
      },
      {
        id: "aura-2-thalia-en",
        displayName: "Aura 2 (Thalia)",
        capability: { ...NOT_CHAT, speechGeneration: "supported" },
        shape: "sync",
      },
    ],
  },
  {
    id: "fish-audio",
    displayName: "Fish Audio",
    serves: { media: "fish-audio" },
    baseUrl: "https://api.fish.audio/v1",
    models: [
      {
        id: "s2.1-pro",
        displayName: "S2.1 Pro",
        capability: { ...NOT_CHAT, speechGeneration: "supported" },
        shape: "sync",
      },
      {
        id: "s1",
        displayName: "S1",
        capability: { ...NOT_CHAT, speechGeneration: "supported" },
        shape: "sync",
      },
      {
        id: "transcribe-1",
        displayName: "Fish Transcribe",
        capability: { ...NOT_CHAT, transcription: "supported" },
        shape: "sync",
      },
    ],
  },
  {
    id: "minimax",
    displayName: "MiniMax",
    serves: { media: "minimax" },
    baseUrl: "https://api.minimax.io",
    models: [
      {
        id: "speech-2.8-hd",
        displayName: "Speech 2.8 HD",
        capability: { ...NOT_CHAT, speechGeneration: "supported" },
        shape: "sync",
      },
      {
        id: "speech-2.8-turbo",
        displayName: "Speech 2.8 Turbo",
        capability: { ...NOT_CHAT, speechGeneration: "supported" },
        shape: "sync",
      },
      {
        id: "MiniMax-H3",
        displayName: "MiniMax H3",
        capability: { ...NOT_CHAT, videoGeneration: "supported" },
        shape: "poll",
      },
      {
        id: "MiniMax-H3-Max",
        displayName: "MiniMax H3 Max",
        capability: { ...NOT_CHAT, videoGeneration: "supported" },
        shape: "poll",
      },
    ],
  },
  {
    id: "elevenlabs",
    displayName: "ElevenLabs",
    serves: { media: "elevenlabs" },
    baseUrl: "https://api.elevenlabs.io/v1",
    models: [
      // eleven_turbo_v2_5 is deprecated in favour of eleven_flash_v2_5;
      // eleven_v3 is the flagship. Scribe v1 is superseded by v2.
      {
        id: "eleven_v3",
        displayName: "Eleven v3",
        capability: { ...NOT_CHAT, speechGeneration: "supported" },
        shape: "sync",
      },
      {
        id: "eleven_multilingual_v2",
        displayName: "Eleven Multilingual v2",
        capability: { ...NOT_CHAT, speechGeneration: "supported" },
        shape: "sync",
      },
      {
        id: "eleven_flash_v2_5",
        displayName: "Eleven Flash v2.5",
        capability: { ...NOT_CHAT, speechGeneration: "supported" },
        shape: "sync",
      },
      {
        id: "scribe_v2",
        displayName: "Scribe v2",
        capability: { ...NOT_CHAT, transcription: "supported" },
        shape: "sync",
      },
    ],
  },
  {
    id: "tavily",
    displayName: "Tavily",
    serves: { retrieval: "tavily" },
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
    serves: { retrieval: "brave" },
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
    serves: { retrieval: "exa" },
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
    serves: { retrieval: "jina" },
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
    serves: { retrieval: "firecrawl" },
    baseUrl: "https://api.firecrawl.dev/v2",
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

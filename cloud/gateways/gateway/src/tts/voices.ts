export const OPENAI_VOICE_NAMES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;
export type OpenAIVoice = (typeof OPENAI_VOICE_NAMES)[number];

/** Generic/Google → OpenAI voice names. Groq standard TTS shares this map. */
export const GENERIC_TO_OPENAI: Record<string, OpenAIVoice> = {
  kore:    "nova",
  aoede:   "nova",
  charon:  "onyx",
  fenrir:  "echo",
  leda:    "shimmer",
  orus:    "alloy",
  puck:    "fable",
  zephyr:  "shimmer",
};

/** Groq Orpheus-specific voice names — passed through unchanged. */
export const GROQ_ORPHEUS_VOICES = new Set([
  "tara", "leah", "jess", "leo", "dan", "mia", "zac", "zoe", "julia",
]);

/** Generic/Google/OpenAI → Groq Orpheus voice names. */
export const GENERIC_TO_GROQ_ORPHEUS: Record<string, string> = {
  alloy:   "leo",
  echo:    "dan",
  fable:   "zac",
  onyx:    "leo",
  nova:    "leah",
  shimmer: "jess",
  kore:    "mia",
  aoede:   "jess",
  charon:  "leo",
  fenrir:  "zac",
  leda:    "mia",
  orus:    "dan",
  puck:    "zac",
  zephyr:  "jess",
};

/** Generic/Google → Alibaba DashScope speaker IDs. */
export const GENERIC_TO_ALIBABA: Record<string, string> = {
  alloy:   "loong",
  nova:    "zhuli",
  onyx:    "qianqiu",
  shimmer: "zhiya",
  kore:    "zhitao",
  aoede:   "zhiya",
  charon:  "qianqiu",
  fenrir:  "yuechen",
  leda:    "chuangirl",
  orus:    "loong",
  puck:    "yuanzao",
  zephyr:  "zhuli",
};

/** Generic/Google → MiniMax built-in voice pool IDs. */
export const GENERIC_TO_MINIMAX: Record<string, string> = {
  alloy:   "male-qn-en",
  nova:    "female-qn-en",
  onyx:    "male-qn-zh",
  shimmer: "female-qn-zh",
  kore:    "female-qn-en",
  aoede:   "female-qn-en",
  charon:  "male-qn-en",
  fenrir:  "male-qn-en",
  leda:    "female-qn-en",
  orus:    "male-qn-en",
  puck:    "male-qn-en",
  zephyr:  "female-qn-en",
};

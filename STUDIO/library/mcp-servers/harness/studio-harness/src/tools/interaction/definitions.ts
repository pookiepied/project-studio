/** Tool schema definitions for user interaction tools. */
export const INTERACTION_DEFINITIONS = [
  {
    name: "ask_user_question",
    description:
      "Ask the user a question and wait for their response before continuing. " +
      "Use this before destructive operations, when multiple valid paths exist, or when user intent is ambiguous. " +
      "Optionally provide suggested answers the user can click.",
    inputSchema: {
      type: "object",
      properties: {
        question:    { type: "string", description: "The question to present to the user" },
        suggestions: {
          type: "array",
          items: { type: "string" },
          description: "Optional quick-reply suggestions (e.g. ['Yes', 'No', 'Cancel'])",
        },
      },
      required: ["question"],
    },
  },
] as const;

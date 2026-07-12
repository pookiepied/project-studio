/** Tool schema definitions for utility tools. */
export const UTILS_DEFINITIONS = [
  {
    name: "sleep",
    description: "Pause execution for a given number of seconds. Useful for rate-limiting or waiting between steps.",
    inputSchema: {
      type: "object",
      properties: {
        seconds: { type: "number", description: "Number of seconds to sleep" },
      },
      required: ["seconds"],
    },
  },
] as const;

/** Tool schema definitions for local STUDIO skill file access. */
export const SKILL_DEFINITIONS = [
  {
    name: "skill_read_local",
    description:
      "Read a locally installed STUDIO skill's SKILL.md from $HOME/.studio/skills/{key}. " +
      "Use after skill_read returns contentReadable=false with a localPath, or when a local app-bundled skill must be loaded while Computer Use is online. " +
      "This reads local skill content only; it does not register, modify, or delete skills.",
    inputSchema: {
      type: "object",
      properties: {
        skill: { type: "string", description: "Skill key, e.g. studio-computer-use" },
      },
      required: ["skill"],
    },
  },
] as const;

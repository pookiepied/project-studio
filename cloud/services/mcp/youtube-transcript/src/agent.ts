import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Env } from "./env";
import { getTranscript } from "./tools/getTranscript";
import { getVideoInfo } from "./tools/getVideoInfo";

const GET_TRANSCRIPT_DESCRIPTION = `
Retrieve the full transcript of a YouTube video.

Attempts to get the transcript in this order:
  1. Creator-uploaded captions (most accurate)
  2. YouTube auto-generated captions (ASR)
  3. Audio transcription via Whisper (if configured — takes longer)

Returns a JSON object. On success, "transcript" contains the full text.
On failure, "transcript" is null and "code" / "message" explain why
(e.g. no captions, no audio, music-only video, API not configured).

Whisper transcription can take 10–30 seconds. Inform the user that
processing is in progress before awaiting the result.
`.trim();

const GET_VIDEO_INFO_DESCRIPTION = `
Retrieve metadata about a YouTube video without fetching the transcript.

Returns title, channel, duration, a short description excerpt,
the list of available caption language codes, whether the video
has an audio track, and whether it is a live stream.

Useful for checking what transcription options are available before
calling get_transcript, especially for long videos.
`.trim();

export class YouTubeTranscriptAgent extends McpAgent<Env> {
  server = new McpServer({
    name: "youtube-transcript",
    version: "1.0.0",
  });

  async init(): Promise<void> {
    this.server.tool(
      "get_transcript",
      GET_TRANSCRIPT_DESCRIPTION,
      {
        url: z
          .string()
          .describe(
            "YouTube video URL. Supports youtube.com/watch?v=, youtu.be/, youtube.com/shorts/, " +
            "mobile (m.youtube.com), music (music.youtube.com), and country-specific TLDs."
          ),
        preferred_language: z
          .string()
          .optional()
          .describe(
            "Preferred transcript language as an ISO 639-1 code (e.g. 'en', 'es', 'de', 'ja'). " +
            "Falls back to English if the preferred language is unavailable, then to any available language."
          ),
      },
      async ({ url, preferred_language }) => {
        const result = await getTranscript(
          { url, preferred_language: preferred_language ?? null },
          this.env
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      }
    );

    this.server.tool(
      "get_video_info",
      GET_VIDEO_INFO_DESCRIPTION,
      {
        url: z.string().describe("YouTube video URL."),
      },
      async ({ url }) => {
        const result = await getVideoInfo({ url }, this.env);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      }
    );
  }
}

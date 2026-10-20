# Audio provider compatibility, 2026-10-20

The OpenRouter speech adapter omitted `voice` when the UI did not select one.
Some models require a built-in voice ID. The public catalog already supplies
`supported_voices`, but Studio discarded it. Retain these IDs and use the selected
model's first advertised voice only when no explicit voice was supplied. The
existing catalog cache avoids repeated lookup between narration passages. No
model-name branch or provider-wide guessed voice is introduced. When metadata is
absent, preserve the provider's default or refusal instead of inventing an ID.

Browser dictation recorded WebM/Opus. MAI Transcribe's specific documentation
lists WAV, MP3 and FLAC. Decode each complete recorder segment locally and encode
real 16 kHz mono, 16-bit PCM WAV before upload. The shared OpenAI transcription
driver previously named every multipart file `dictation.webm`; its filename now
matches the supplied MIME type. Other callers retain their original formats.
Each provider adapter still owns its own JSON, multipart or raw-byte contract.

Read-aloud and dictation failures now show a compact label. Clicking it opens the
existing Studio popover with wrapped, scrollable details. Retry and dismiss
remain available. Long provider text no longer stretches the control row.

## Compatibility policy

Use provider-advertised metadata and explicit user choices. Keep provider wire
requirements inside its adapter. A listed model is not a promise that an unknown
future request contract needs no configuration or adapter work. This change does
not claim universal support for every future model, add cloned voices, or infer
voices from model names. Missing provider requirements remain visible errors.

`media.voice.resolve` uses the existing execution parent and passive capture
policy. It excludes voice IDs, speech and keys from attributes. The public
metadata request sends no credential. No database migration or dependency change.

## Evidence

- Before the fix, focused regressions failed on discarded voice IDs and the
  provider's explicit-voice rejection; after the fix all 15 then-current cases
  passed.
- Six provider/media test files passed, 60 cases, including real loopback wire
  fixtures for OpenRouter, OpenAI, ElevenLabs, Deepgram, Fish, Google and Fal.
- Six focused client files passed, 25 cases, covering WAV encoding, decoding
  failure without upload, retry behavior, error details and dictation lifetime.
- Headless Edge recorded an oscillator into WebM/Opus without microphone or
  speaker access. The actual client decoder produced RIFF PCM WAV: mono,
  16 kHz, 7,680 sample bytes from the 4,160-byte recording.
- At 360 by 480 pixels, a 10,000-character error stayed within the viewport:
  panel x=16..336, y=190..472; details scrolled and page width stayed 360.
- Client production build passed. Full harness gate passed: typecheck, lint,
  build and 2,567 tests; 28 skipped. Final typecheck/lint also passed after the
  last model-switch fixture was added. The full client gate then passed:
  typecheck, lint and 1,587 tests across 176 files.
- Negative controls: changing the upload MIME back to WebM and putting the full
  error in the control row caused all three relevant regressions to fail. Both
  mutations were restored before the final client gate. Corrupting the WAV file
  signature also failed both the PCM encoder and actual-upload seam regressions;
  that mutation was restored as well.
- Restoring the old hard-coded multipart filename failed the WAV route test.
  The driver was restored to its exact pre-mutation SHA-256 before rerunning all
  six provider/media files successfully.

These are local wire and browser checks, not authenticated paid-provider calls.
Restart Studio to load the changed client and harness before trying dictation
and read aloud with the configured account.

## Provider references

- [OpenRouter speech and voice requirements](https://openrouter.ai/docs/guides/overview/multimodal/tts)
- [OpenRouter transcription request contract](https://openrouter.ai/docs/guides/overview/multimodal/stt)
- [MAI Transcribe supported audio](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-transcribe)
- [Public speech model catalog](https://openrouter.ai/api/v1/models?output_modalities=speech)

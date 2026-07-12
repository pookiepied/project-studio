# Edge TTS Demo

A tiny desktop GUI that turns typed text into spoken audio using Microsoft's
free [Edge TTS](https://github.com/ranyelhousieny/edge-tts) service, played
back with `pygame`. Built with the standard-library `tkinter`, so there are no
extra UI dependencies.

## Requirements

- Python 3.11 (any recent Python 3 works)
- An internet connection for the first voice-list fetch and for synthesis
  (the app falls back to a small hardcoded voice list if offline)

## Install

```bash
pip install -r requirements.txt
```

## Run

```bash
python tts_demo.py
```

## Usage

1. On startup the app fetches the available Edge TTS voices in a background
   thread and populates the **Voice** dropdown (default: `en-US-AndrewNeural`).
   If the fetch fails it falls back to a small built-in list.
2. Type any text into the multi-line box.
3. Click **Speak** to download and play the audio. The status bar shows
   `Downloading audio...` → `Playing...` → `Done`. The Speak button is disabled
   while audio is playing.
4. Click **Stop** at any time to halt playback.

## Files

- `tts_demo.py` — the entire application
- `requirements.txt` — `edge-tts` and `pygame`

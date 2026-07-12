"""A simple, self-contained Edge TTS desktop demo using tkinter + pygame."""

import asyncio
import os
import subprocess
import sys
import tempfile
import threading

import edge_tts
import pygame
import tkinter as tk
import tkinter.ttk as ttk

# Hardcoded fallback voices used if the live voice list cannot be fetched.
FALLBACK_VOICES = [
    "en-US-AndrewNeural",
    "en-US-AriaNeural",
    "en-US-BrianNeural",
    "en-GB-RyanNeural",
    "en-GB-SoniaNeural",
]
DEFAULT_VOICE = "en-US-AndrewNeural"


class TTSApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("Edge TTS Demo")
        self.root.geometry("600x400")

        # Initialize the pygame mixer exactly once at startup.
        pygame.mixer.init()

        self.voices: list[str] = []
        self.temp_file: str | None = None

        self._build_ui()

        # Fetch the voice list in a background thread so the UI never freezes.
        self.set_status("Loading voices...")
        threading.Thread(target=self._fetch_voices, daemon=True).start()

    # ------------------------------------------------------------------ UI
    def _build_ui(self) -> None:
        # Multi-line text entry.
        self.text = tk.Text(self.root, wrap=tk.WORD, height=10)
        self.text.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        # Voice selector row.
        selector_frame = ttk.Frame(self.root)
        selector_frame.pack(fill=tk.X, padx=10)
        ttk.Label(selector_frame, text="Voice:").pack(side=tk.LEFT)
        self.voice_var = tk.StringVar()
        self.voice_combo = ttk.Combobox(
            selector_frame, textvariable=self.voice_var, state="readonly"
        )
        self.voice_combo.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(5, 0))

        # Buttons row.
        btn_frame = ttk.Frame(self.root)
        btn_frame.pack(fill=tk.X, padx=10, pady=10)
        self.speak_btn = ttk.Button(btn_frame, text="Speak", command=self.on_speak)
        self.speak_btn.pack(side=tk.LEFT, padx=(0, 5))
        self.stop_btn = ttk.Button(btn_frame, text="Stop", command=self.on_stop)
        self.stop_btn.pack(side=tk.LEFT)

        # Status label at the bottom.
        self.status_var = tk.StringVar(value="Ready")
        self.status_label = ttk.Label(
            self.root, textvariable=self.status_var, anchor=tk.W
        )
        self.status_label.pack(fill=tk.X, padx=10, pady=(0, 10))

    def set_status(self, text: str) -> None:
        """Thread-safe status update via the Tk event loop."""
        self.root.after(0, lambda: self.status_var.set(text))

    # ------------------------------------------------------------ Voices
    def _fetch_voices(self) -> None:
        try:
            result = subprocess.run(
                [sys.executable, "-m", "edge_tts", "--list-voices"],
                capture_output=True,
                text=True,
                timeout=30,
            )
            voices: list[str] = []
            for line in result.stdout.splitlines():
                line = line.strip()
                if line.startswith("Name:"):
                    name = line[len("Name:"):].strip().split()[0]
                    if name:
                        voices.append(name)
            if not voices:
                raise ValueError("No voices parsed from output")
            self.voices = voices
        except Exception:
            # Offline / failure -> fall back to a small hardcoded list.
            self.voices = list(FALLBACK_VOICES)

        def update_combo() -> None:
            self.voice_combo["values"] = self.voices
            if DEFAULT_VOICE in self.voices:
                self.voice_var.set(DEFAULT_VOICE)
            elif self.voices:
                self.voice_var.set(self.voices[0])
            self.set_status("Ready")

        self.root.after(0, update_combo)

    # ------------------------------------------------------------- Speak
    def on_speak(self) -> None:
        text = self.text.get("1.0", tk.END).strip()
        if not text:
            self.set_status("Please enter some text first.")
            return

        voice = self.voice_var.get() or DEFAULT_VOICE
        self.speak_btn.config(state=tk.DISABLED)
        self.set_status("Downloading audio...")
        threading.Thread(
            target=self._speak_worker, args=(text, voice), daemon=True
        ).start()

    def _speak_worker(self, text: str, voice: str) -> None:
        try:
            # Stream the synthesized audio to a temp .mp3 file.
            fd, path = tempfile.mkstemp(suffix=".mp3")
            os.close(fd)
            self.temp_file = path

            async def _stream() -> None:
                communicate = edge_tts.Communicate(text, voice)
                with open(path, "wb") as audio_file:
                    async for chunk in communicate.stream():
                        if chunk["type"] == "audio":
                            audio_file.write(chunk["data"])

            asyncio.run(_stream())

            # Play the file with pygame and poll for completion.
            self.set_status("Playing...")
            pygame.mixer.music.load(path)
            pygame.mixer.music.play()
            self.root.after(0, self._poll_playback)
        except Exception as exc:  # noqa: BLE001 - surface any failure to the UI
            self.set_status(f"Error: {exc}")
            self.root.after(0, lambda: self.speak_btn.config(state=tk.NORMAL))

    def _poll_playback(self) -> None:
        if pygame.mixer.music.get_busy():
            self.root.after(200, self._poll_playback)
        else:
            self.set_status("Done")
            self.speak_btn.config(state=tk.NORMAL)
            self._cleanup_temp()

    def _cleanup_temp(self) -> None:
        if self.temp_file and os.path.exists(self.temp_file):
            try:
                os.remove(self.temp_file)
            except OSError:
                pass
        self.temp_file = None

    # -------------------------------------------------------------- Stop
    def on_stop(self) -> None:
        pygame.mixer.music.stop()
        self.set_status("Stopped")
        self.speak_btn.config(state=tk.NORMAL)
        self._cleanup_temp()


def main() -> None:
    root = tk.Tk()
    TTSApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()

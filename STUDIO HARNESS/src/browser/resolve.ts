import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

/**
 * Finding a browser that is already on the machine, and refusing well when
 * there is none.
 *
 * ADR 0049's first decision is that Studio ships no engine, and its 2026-09-15
 * amendment says what that rule is and is not. It is **never download**. It
 * is not "never name a path": a browser we *found* at a place we know is
 * still the person's browser, kept up to date by them, and driving it is the
 * same act as driving Edge through a channel name. The two things that would
 * bring a download back - the full `playwright` package, whose install step
 * fetches browsers, and a path that came from anywhere but `FOUND` below -
 * are what the test pins.
 *
 * Two tiers, tried in order:
 *
 * 1. **Channels.** `playwright-core` knows Edge and Chrome by name and finds
 *    them itself, wherever they are installed. Tried whether or not we can
 *    see them, because seeing is not how launching works.
 * 2. **Found paths.** Browsers the library has no name for - Chromium on
 *    Linux, Brave everywhere - at the places their installers put them. Only
 *    a path that exists is tried, and only from this list.
 *
 * What is deliberately not here: the WebView2 runtime. It is a Chromium and
 * it is on every Windows machine Studio runs on, so it looked like a way to
 * survive a machine whose Edge was removed. Measured on 2026-09-15: it
 * launches and closes before answering. It is not a browser and is not
 * treated as one.
 *
 * The refusal is the deliverable, not the afterthought. It names what was
 * looked for, where it looked, and what to install, which is ADR 0047's shape
 * for exactly this situation: a refusal that names the fix is actionable, and
 * a bare failure is a bug report.
 */

/**
 * The channels we will drive, in the order we prefer them.
 *
 * Edge first, and on Windows that is effectively a guarantee rather than a
 * preference: Edge ships with Windows 11. Chrome second, because a machine
 * without Edge very often has it. Both are Blink, so a page renders the same
 * either way and the order is about what is *there*, not about what is better.
 */
export const CHANNELS = ["msedge", "chrome"] as const;

export type BrowserChannel = (typeof CHANNELS)[number];

/** How a candidate is handed to `chromium.launch`. */
export type BrowserLaunch =
  | { readonly channel: BrowserChannel }
  | { readonly executablePath: string };

/** One browser worth trying: its name for a person, and how to launch it. */
export interface BrowserCandidate {
  /** A product name a person recognises: "Microsoft Edge", "Brave". */
  readonly name: string;
  readonly launch: BrowserLaunch;
  /** Where it was seen, when it was seen. A channel may be launched unseen. */
  readonly seenAt?: string;
}

const NAMES: Readonly<Record<BrowserChannel, string>> = {
  msedge: "Microsoft Edge",
  chrome: "Google Chrome",
};

function local(...parts: readonly string[]): string {
  const base = process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local");
  return join(base, ...parts);
}

/**
 * Where each channel normally lives, per platform.
 *
 * Used to order the attempts and to write the refusal. Launching goes through
 * the channel name, so a browser installed somewhere unusual still works and
 * simply is not named in a message nobody will ever read. Getting this list
 * wrong therefore costs a slightly vaguer sentence and never a working
 * browser.
 */
function channelLocations(channel: BrowserChannel): readonly string[] {
  switch (platform()) {
    case "win32":
      return channel === "msedge"
        ? [
            "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
            "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
          ]
        : [
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
            local("Google", "Chrome", "Application", "chrome.exe"),
          ];
    case "darwin":
      return channel === "msedge"
        ? ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
        : ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
    case "linux":
      return channel === "msedge"
        ? ["/opt/microsoft/msedge/msedge", "/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"]
        : ["/opt/google/chrome/chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];
    default:
      return [];
  }
}

/**
 * Browsers the library cannot name, at the places their installers put them.
 *
 * This list is the whole authority for a path: a candidate carries an
 * `executablePath` only if it came from here and exists. Chromium is the one
 * that matters most - it is what a Linux machine with "a browser" usually
 * has, and it is not a channel. Brave is a plain Chromium with its own
 * installer directory and is common enough on every platform to be worth two
 * lines each.
 */
function foundLocations(): readonly { readonly name: string; readonly paths: readonly string[] }[] {
  switch (platform()) {
    case "win32":
      return [
        {
          name: "Brave",
          paths: [
            "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
            local("BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
          ],
        },
      ];
    case "darwin":
      return [
        { name: "Brave", paths: ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"] },
        { name: "Chromium", paths: ["/Applications/Chromium.app/Contents/MacOS/Chromium"] },
      ];
    case "linux":
      return [
        {
          name: "Chromium",
          paths: [
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/snap/bin/chromium",
            "/usr/lib/chromium/chromium",
            "/var/lib/flatpak/exports/bin/org.chromium.Chromium",
          ],
        },
        {
          name: "Brave",
          paths: ["/usr/bin/brave-browser", "/usr/bin/brave", "/opt/brave.com/brave/brave"],
        },
      ];
    default:
      return [];
  }
}

/** Every path we would recognise on this platform, for the refusal. */
export function knownLocations(): readonly string[] {
  return [
    ...CHANNELS.flatMap((channel) => channelLocations(channel)),
    ...foundLocations().flatMap((entry) => entry.paths),
  ];
}

/**
 * The browsers worth trying, in the order to try them.
 *
 * Every channel, always, with any we can see first; then every found path
 * that exists. A channel we cannot see is still worth trying, because the
 * library looks in more places than this file does. A path we cannot see is
 * not, because a path is the whole instruction.
 */
export function candidates(): readonly BrowserCandidate[] {
  const seen: BrowserCandidate[] = [];
  const unseen: BrowserCandidate[] = [];
  for (const channel of CHANNELS) {
    const at = channelLocations(channel).find((path) => existsSync(path));
    const candidate: BrowserCandidate =
      at === undefined
        ? { name: NAMES[channel], launch: { channel } }
        : { name: NAMES[channel], launch: { channel }, seenAt: at };
    (at === undefined ? unseen : seen).push(candidate);
  }
  const found: BrowserCandidate[] = [];
  for (const entry of foundLocations()) {
    const at = entry.paths.find((path) => existsSync(path));
    if (at !== undefined) found.push({ name: entry.name, launch: { executablePath: at }, seenAt: at });
  }
  return [...seen, ...unseen, ...found];
}

/**
 * What a settings screen says about the browser before anyone asks for one.
 *
 * The server process starts fine on a machine with no browser - the failure
 * lives in the first tool call, which is the worst place for a person to
 * learn about it. This is the same look `candidates()` takes, worded for a
 * row: which browser will be driven, or that none was seen and what to
 * install. "Seen" rather than "will work", because only a launch decides.
 */
export interface BrowserEngineReport {
  /** The browser that will be tried first among those seen, if any. */
  readonly seen?: { readonly name: string; readonly at: string };
  /** Every other browser seen, by name. */
  readonly alsoSeen: readonly string[];
  /** One sentence for a row. */
  readonly summary: string;
}

export function engineReport(): BrowserEngineReport {
  const seen = candidates().filter(
    (candidate): candidate is BrowserCandidate & { seenAt: string } => candidate.seenAt !== undefined,
  );
  const first = seen[0];
  if (first === undefined) {
    return {
      alsoSeen: [],
      summary:
        "No browser found. Studio never downloads one; install Microsoft Edge, Google Chrome, Brave or Chromium.",
    };
  }
  const others = seen.slice(1).map((candidate) => candidate.name);
  return {
    seen: { name: first.name, at: first.seenAt },
    alsoSeen: others,
    summary: others.length === 0 ? `Drives ${first.name}.` : `Drives ${first.name}; ${others.join(", ")} also found.`,
  };
}

/**
 * What to say when the machine has no browser we can drive.
 *
 * Two readers, in this order. The **model** reads it first, as a tool result,
 * and needs two things: that trying again will not help, and what to tell
 * the person. The **person** then reads it as relayed, and needs the three
 * facts in the order they act on them: what was looked for, where, and what
 * to install - and that Firefox is not on the list, because it is the one
 * browser someone is likely to have and to try. The last error is included
 * because it is occasionally the real story: a browser that exists and cannot
 * start says something quite different from one that is absent.
 */
export function noBrowserMessage(lastError: string | undefined): string {
  const install =
    platform() === "win32"
      ? "Install Microsoft Edge, Google Chrome or Brave. On Windows 11 Edge is normally already present, so a missing one usually means it was removed."
      : platform() === "linux"
        ? "Install Chromium (for example `sudo apt install chromium` or `sudo dnf install chromium`), Google Chrome, Brave or Microsoft Edge."
        : "Install Google Chrome, Microsoft Edge, Brave or Chromium.";
  const lines = [
    "No browser is installed on this machine that Studio can drive, so the browser tools cannot run.",
    "",
    "This is not something to retry or work around in this conversation: every browser tool will fail",
    "the same way until a browser is installed. Tell the person what follows, then carry on without",
    "the browser.",
    "",
    "Studio never downloads a browser. It drives one already installed on this machine, and it needs",
    `a Chromium-based one - Firefox and Safari will not do. It looked for ${CHANNELS.map((channel) => NAMES[channel]).join(" and ")}`,
    "by name, then for Brave or Chromium at these places:",
    ...knownLocations().map((path) => `  ${path}`),
    "",
    `To fix it: ${install} Studio finds it on the next call; no restart is needed.`,
  ];
  if (lastError !== undefined && lastError !== "") {
    lines.push("", `The last attempt said: ${lastError}`);
  }
  return lines.join("\n");
}

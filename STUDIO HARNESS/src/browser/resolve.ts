import { existsSync } from "node:fs";
import { platform } from "node:os";

/**
 * Finding a browser that is already on the machine, and refusing well when
 * there is none.
 *
 * ADR 0049's first decision is that Studio ships no engine. `playwright-core`
 * is asked for a *channel* — a browser the person installed and keeps updated
 * — and never for a download. That is not a setting we happen to leave alone:
 * the library's own default is to download, so its absence has to be pinned by
 * a test, and the only way this file can launch anything is through a channel
 * named here.
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
 * preference: Edge ships with Windows 11 and the WebView2 runtime is present
 * regardless. Chrome second, because a machine without Edge very often has it.
 * Both are Blink, so a page renders the same either way and the order is about
 * what is *there*, not about what is better.
 */
export const CHANNELS = ["msedge", "chrome"] as const;

export type BrowserChannel = (typeof CHANNELS)[number];

/**
 * Where each channel normally lives, per platform.
 *
 * Used only to write the refusal. Launching goes through the channel name, so
 * a browser installed somewhere unusual still works and simply is not named
 * in a message nobody will ever read. Getting this list wrong therefore costs
 * a slightly vaguer sentence and never a working browser.
 */
const LOCATIONS: Readonly<Record<NodeJS.Platform, Readonly<Record<BrowserChannel, readonly string[]>>>> =
  {
    win32: {
      msedge: [
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      ],
      chrome: [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      ],
    },
    darwin: {
      msedge: ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
      chrome: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
    },
    linux: {
      msedge: ["/opt/microsoft/msedge/msedge", "/usr/bin/microsoft-edge"],
      chrome: ["/opt/google/chrome/chrome", "/usr/bin/google-chrome"],
    },
  } as unknown as Readonly<
    Record<NodeJS.Platform, Readonly<Record<BrowserChannel, readonly string[]>>>
  >;

function locationsFor(channel: BrowserChannel): readonly string[] {
  return LOCATIONS[platform()]?.[channel] ?? [];
}

/** Every path we would recognise, across both channels, on this platform. */
export function knownLocations(): readonly string[] {
  return CHANNELS.flatMap((channel) => locationsFor(channel));
}

/**
 * The channels that look installed, in preference order.
 *
 * A hint rather than an answer: a browser somewhere unusual is invisible here
 * and still launches, so this is used to *order* the attempts and to decide
 * whether the refusal has anything hopeful to say. The launch itself is the
 * only thing that actually decides.
 */
export function likelyChannels(): readonly BrowserChannel[] {
  const found = CHANNELS.filter((channel) =>
    locationsFor(channel).some((path) => existsSync(path)),
  );
  // Everything, always, with anything we can see first. A channel we cannot
  // see is still worth trying, because seeing is not how launching works.
  return [...found, ...CHANNELS.filter((channel) => !found.includes(channel))];
}

/**
 * What to tell a person whose machine has no browser we can drive.
 *
 * Three facts, in the order someone acts on them: what was looked for, where
 * we looked, and what to do. The last error is included because it is
 * occasionally the real story — a browser that exists and cannot start says
 * something quite different from one that is absent.
 */
export function noBrowserMessage(lastError: string | undefined): string {
  const lines = [
    "Studio could not find a browser to drive, so it did not start one.",
    "",
    "Studio never downloads a browser. It drives one already installed on this",
    `machine, and it looks for these, in order: ${CHANNELS.join(", ")}.`,
    "",
    "Looked in:",
    ...knownLocations().map((path) => `  ${path}`),
    "",
    platform() === "win32"
      ? "Install Microsoft Edge or Google Chrome and try again. On Windows 11 Edge is normally already present, so a missing one usually means it was removed."
      : "Install Microsoft Edge or Google Chrome and try again.",
  ];
  if (lastError !== undefined && lastError !== "") {
    lines.push("", `The last attempt said: ${lastError}`);
  }
  return lines.join("\n");
}

import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The order in which undo does its two jobs, and why it is worth a file.
 *
 * `sudo pnpm sandbox:prepare --undo` has to unload the AppArmor profile from
 * the kernel and delete it from disk. The first version did those in the
 * obvious order — delete, then unload — and swallowed the unload's failure.
 * That order cannot work: `apparmor_parser -R` reads the file to learn which
 * profile to unload, so once the file is gone the kernel keeps the profile with
 * no supported way to name it until the machine reboots.
 *
 * Measured on Ubuntu 24.04. The command printed "the sandbox will refuse work
 * on this machine again", exited zero, and bubblewrap went on containing
 * happily with the profile still listed in `aa-status`. Nothing about the
 * output suggested looking closer, which is what makes it worth pinning: a
 * loud failure gets fixed, a confident wrong answer does not.
 *
 * `node:child_process` is mocked here rather than in the main isolation suite
 * because the mock is module-wide, and a stray mocked `execFileSync` would
 * quietly change what the other tests in that file are measuring.
 */

const execFileSync = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFileSync }));

const { removeProfile, PROFILE_PATH } = await import(
  "../../src/sandbox/isolation/linux/apparmor.js"
);

describe("removing the Linux sandbox profile", () => {
  beforeEach(() => {
    execFileSync.mockReset();
  });

  it("unloads the profile before the file it names is deleted", () => {
    const order: string[] = [];
    execFileSync.mockImplementation(() => {
      order.push("unload");
    });

    removeProfile(() => order.push("delete"));

    expect(order).toEqual(["unload", "delete"]);
  });

  it("asks apparmor to remove exactly the profile that was installed", () => {
    removeProfile(() => {});

    expect(execFileSync).toHaveBeenCalledWith(
      "apparmor_parser",
      ["-R", PROFILE_PATH],
      expect.anything(),
    );
  });

  it("keeps the file when the unload fails, so the undo can be retried", () => {
    // The reason this throws instead of pressing on. A file deleted after a
    // failed unload is the same dead end as deleting it first — the grant is
    // still live and nothing on disk can name it any more.
    execFileSync.mockImplementation(() => {
      throw new Error("apparmor_parser: profile is in use");
    });
    const remove = vi.fn();

    expect(() => removeProfile(remove)).toThrow(/in use/);
    expect(remove).not.toHaveBeenCalled();
  });
});

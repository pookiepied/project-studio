/**
 * Sign-in entry point.
 *
 * Usage:
 *   pnpm auth sign-in
 *   pnpm auth status
 *   pnpm auth sign-out
 *
 * This is the harness-owned login: it does not require the desktop app to be
 * running, so the harness can be used headless or from a terminal. The desktop
 * app will later drive the same flow rather than reimplementing it.
 */
import { StudioAuthError } from "./errors.js";
import { isSignedIn, signIn, signOut } from "./login.js";

async function main(): Promise<number> {
  const command = process.argv[2] ?? "sign-in";

  switch (command) {
    case "sign-in": {
      const user = await signIn({
        onPrompt: (url) => {
          process.stdout.write(
            `Opening your browser to sign in to Project Studio.\nIf it does not open, use this link:\n\n${url}\n\n`,
          );
        },
      });
      process.stdout.write(`Signed in as ${user.email}.\n`);
      return 0;
    }

    case "status": {
      const signedIn = await isSignedIn();
      process.stdout.write(
        signedIn
          ? "Signed in to Project Studio on this machine.\n"
          : "Not signed in. Run: pnpm auth sign-in\n",
      );
      return signedIn ? 0 : 1;
    }

    case "sign-out": {
      await signOut();
      process.stdout.write("Signed out. The stored session was removed.\n");
      return 0;
    }

    default: {
      process.stderr.write(
        `Unknown command "${command}". Expected sign-in, status, or sign-out.\n`,
      );
      return 2;
    }
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // Sign-in failures are user-facing, so the typed message is printed and the
    // stack is not: it would carry no useful detail and this path handles
    // credentials.
    const message =
      error instanceof StudioAuthError
        ? error.message
        : "Project Studio sign-in failed unexpectedly.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });

import { rm } from "node:fs/promises";

/** Windows can retain a child's working-directory handle briefly after exit. */
export async function removeTestDirectory(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

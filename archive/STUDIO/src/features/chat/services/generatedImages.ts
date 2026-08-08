/**
 * Generated-image lifecycle for cloud conversations.
 *
 * These helpers understand the cloud image endpoint shape, so they belong to
 * the chat feature's cloud concern rather than to run-event display. Moved out
 * of the former `runtime/ui/classifyToolDisplay.ts` when that module was
 * extracted to `run-events/classify`.
 *
 * Target owner once the cloud client folder exists: `cloud/chat`.
 */

const GENERATED_IMAGE_RE =
  /\/adapters\/openai\/v1\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;

export function extractGeneratedImageIds(text: string): string[] {
  const ids: string[] = [];
  const re = new RegExp(GENERATED_IMAGE_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) ids.push(m[1]);
  return ids;
}

export function deleteRemoteImages(
  imageIds: string[],
  apiBase: string
): void {
  for (const id of imageIds) {
    fetch(`${apiBase}/adapters/openai/v1/images/${id}`, {
      method: "DELETE",
    }).catch(() => {});
  }
}

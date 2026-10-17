/** File metadata is protected until drop; `types` is available during hover. */
export function isFileDrag(event: DragEvent): boolean {
  const transfer = event.dataTransfer
  return transfer ? Array.from(transfer.types ?? []).includes('Files') || transfer.files.length > 0 : false
}

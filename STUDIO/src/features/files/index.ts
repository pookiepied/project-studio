/**
 * Files a reply mentions: recognising them, finding them, and acting on them.
 *
 *   pathReference   reads a reference out of text; touches nothing
 *   useLocatedFile  asks the harness where it really is
 *   fileKinds       what each kind of file offers
 *   useFileVerbs    runs those offers
 *   FileReference   the chip in a reply, FileMenu the menu it opens
 *   FilePreview     the viewer in the side rail
 *
 * The limits live elsewhere on purpose: the harness (`conversations/files.ts`)
 * decides what a conversation may read, and the native host (`open_file.rs`)
 * decides what may be opened.
 */
export { FilePathLabel, FileReference } from './FileReference'
export { FilePreview } from './FilePreview'
export type { LocatedFile } from './useLocatedFile'

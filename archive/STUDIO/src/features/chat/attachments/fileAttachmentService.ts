import { fileValidationService } from "./fileValidationService";
import { processPDF } from "./pdfAttachmentService";

interface FileAttachmentServerDoc {
  docId:     string;
  permanent: boolean;
  expiresAt?: number; // unix ms — only present for temporary uploads
}

export interface FileAttachment {
  id: string;
  name: string;
  type: string;
  extension: string;
  size: number;
  content?: string;
  contextPrompt: string;
  file?: File;
  isImage?: boolean;
  isPDF?: boolean;
  pdfPageImages?: string[]; // base64 JPEG strings for scanned PDFs (vision path)
  pdfPageCount?: number;
  validationWarnings?: string[];
  /** Set when the file was also uploaded to the server's R2 document store. */
  serverDoc?: FileAttachmentServerDoc;
}

const MAX_IMAGE_FILE_SIZE = 20 * 1024 * 1024;
const MAX_DOCUMENT_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_PDF_FILE_SIZE = 25 * 1024 * 1024;      // 25MB
const IMAGE_TYPES =['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
const DOCUMENT_TYPES = [
  '.txt', '.md', '.markdown', '.csv', '.log',
  '.json', '.xml', '.yaml', '.yml', '.toml',
  '.html', '.htm',
  '.js', '.ts', '.jsx', '.tsx',
  '.py', '.go', '.rs', '.java', '.c', '.cpp', '.cs', '.rb', '.php', '.sh',
];
const PDF_TYPES = ['.pdf'];

function getExt(filename: string): string {
  return filename.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
}

function isImageFile(filename: string): boolean {
  return IMAGE_TYPES.includes(getExt(filename));
}

function isDocumentFile(filename: string): boolean {
  return DOCUMENT_TYPES.includes(getExt(filename));
}

function isPDFFile(filename: string): boolean {
  return PDF_TYPES.includes(getExt(filename));
}

function makeId(): string {
  return `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export async function processFile(file: File): Promise<FileAttachment> {
  const isImage = isImageFile(file.name);
  const isDocument = isDocumentFile(file.name);
  const isPDF = isPDFFile(file.name);

  if (!isImage && !isDocument && !isPDF) {
    const supported = [...IMAGE_TYPES, ...DOCUMENT_TYPES, ...PDF_TYPES].join(', ');
    throw new Error(`Unsupported file type. Supported: ${supported}`);
  }

  // ── PDF handling ───────────────────────────────────────────────────────────
  if (isPDF) {
    const validation = await fileValidationService.validateFile(file, {
      maxSize: MAX_PDF_FILE_SIZE,
      checkContent: false, // magic bytes checked inside processPDF
      sanitizeName: true,
    });
    if (!validation.isValid) throw new Error(validation.errors.join('; '));

    const result = await processPDF(file);
    if (!result.success) throw new Error(result.error.message);

    const { data } = result;
    const fileName = validation.sanitizedName || file.name;
    const ext = file.name.match(/\.[^.]+$/)?.[0] || '.pdf';
    const pageLabel = `${data.pageCount} page${data.pageCount !== 1 ? 's' : ''}`;

    if (data.type === 'text') {
      return {
        id: makeId(),
        name: fileName,
        type: file.type || 'application/pdf',
        extension: ext,
        size: file.size,
        content: data.text,
        contextPrompt: `Here is the PDF "${fileName}" (${pageLabel}):`,
        file,
        isImage: false,
        isPDF: true,
        pdfPageCount: data.pageCount,
        validationWarnings: validation.warnings.length > 0 ? validation.warnings : undefined,
      };
    }

    // Scanned PDF — page images forwarded through the vision pipeline
    const shownPages = data.pageImages!.length;
    const pageNote = data.pageCount > shownPages
      ? ` — showing first ${shownPages} of ${data.pageCount}`
      : '';
    return {
      id: makeId(),
      name: fileName,
      type: file.type || 'application/pdf',
      extension: ext,
      size: file.size,
      contextPrompt: `Here is the scanned PDF "${fileName}" (${pageLabel}${pageNote}):`,
      file,
      isImage: false,
      isPDF: true,
      pdfPageImages: data.pageImages,
      pdfPageCount: data.pageCount,
      validationWarnings: validation.warnings.length > 0 ? validation.warnings : undefined,
    };
  }

  // ── Image / document handling ──────────────────────────────────────────────
  const maxSize = isImage ? MAX_IMAGE_FILE_SIZE : MAX_DOCUMENT_FILE_SIZE;
  const validation = await fileValidationService.validateFile(file, {
    maxSize,
    checkContent: true,
    sanitizeName: true,
  });

  if (!validation.isValid) {
    throw new Error(validation.errors.join('; '));
  }

  const fileName = validation.sanitizedName || file.name;
  const ext = file.name.match(/\.[^.]+$/)?.[0] || '';

  if (isImage) {
    return {
      id: makeId(),
      name: fileName,
      type: file.type,
      extension: ext,
      size: file.size,
      contextPrompt: `Here is my image "${fileName}":`,
      file,
      isImage: true,
      validationWarnings: validation.warnings.length > 0 ? validation.warnings : undefined,
    };
  }

  // Document — read as text and inline into the message context
  const content = await file.text();

  return {
    id: makeId(),
    name: fileName,
    type: file.type,
    extension: ext,
    size: file.size,
    content,
    contextPrompt: `Here is the file "${fileName}":`,
    file,
    isImage: false,
    validationWarnings: validation.warnings.length > 0 ? validation.warnings : undefined,
  };
}

export function estimateAttachmentTokens(attachment: FileAttachment): number {
  if (attachment.isImage) {
    return 0;
  }
  
  if (!attachment.content) return 0;
  
  const fullText = `${attachment.contextPrompt}\n\`\`\`${attachment.extension.slice(1)}\n${attachment.content}\n\`\`\``;
  const baseTokens = Math.ceil(fullText.length / 4);
  const bufferedTokens = Math.ceil(baseTokens * 1.1);
  
  return bufferedTokens;
}


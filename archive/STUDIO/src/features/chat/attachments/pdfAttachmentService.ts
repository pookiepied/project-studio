import * as pdfjsLib from 'pdfjs-dist';

// Vite resolves this to the correct bundled worker path at build time
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

type PDFProcessType = 'text' | 'images';

interface PDFProcessResult {
  type: PDFProcessType;
  text?: string;        // populated when type === 'text'
  pageImages?: string[]; // base64 JPEG strings (no data: prefix) when type === 'images'
  pageCount: number;    // total pages in the original PDF
  fileName: string;
}

interface PDFProcessError {
  code: 'empty' | 'too_large' | 'password_protected' | 'corrupted' | 'unknown';
  message: string;
}

export type PDFProcessOutcome =
  | { success: true; data: PDFProcessResult }
  | { success: false; error: PDFProcessError };

const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_PAGES = 20;                    // cap for both text and image extraction
const MIN_TEXT_CHARS = 100;             // below this we consider the PDF scanned
const RENDER_SCALE = 1.5;              // 108 dpi, good OCR quality and reasonable size

/**
 * Process a PDF File object for use as a chat attachment.
 *
 * Strategy:
 *  1. Validate size and magic bytes.
 *  2. Load with pdf.js and attempt text extraction on every page up to MAX_PAGES.
 *  3. If extracted text is substantial (>= MIN_TEXT_CHARS): return it as-is so
 *     it is inlined in the message like any other document. All LLMs can read it.
 *  4. If text is sparse (scanned PDF): render each page to a JPEG canvas and
 *     return the base64 strings. These are forwarded through the vision pipeline
 *     (R2 presigned URLs to image_url parts) so vision-capable models can OCR them.
 */
export async function processPDF(file: File): Promise<PDFProcessOutcome> {
  if (file.size === 0) {
    return { success: false, error: { code: 'empty', message: 'PDF file is empty.' } };
  }

  if (file.size > MAX_PDF_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return {
      success: false,
      error: { code: 'too_large', message: `PDF is ${mb} MB. Maximum allowed is 25 MB.` },
    };
  }

  try {
    const arrayBuffer = await file.arrayBuffer();

    // Reject non-PDF files masquerading as PDFs
    const magic = new Uint8Array(arrayBuffer, 0, 5);
    const header = String.fromCharCode(...magic);
    if (!header.startsWith('%PDF-')) {
      return {
        success: false,
        error: { code: 'corrupted', message: 'File is not a valid PDF (missing %PDF- header).' },
      };
    }

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      disableStream: true,
      disableAutoFetch: true,
    });

    const pdf = await loadingTask.promise;
    const totalPages = pdf.numPages;
    const pagesToProcess = Math.min(totalPages, MAX_PAGES);

    // Pass 1: text extraction
    let fullText = '';
    for (let p = 1; p <= pagesToProcess; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: any) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (pageText) {
        fullText += (fullText ? '\n\n' : '') + `[Page ${p}]\n${pageText}`;
      }
    }

    if (fullText.length >= MIN_TEXT_CHARS) {
      if (totalPages > MAX_PAGES) {
        fullText += `\n\n[Note: Showing first ${MAX_PAGES} of ${totalPages} pages]`;
      }
      return {
        success: true,
        data: { type: 'text', text: fullText, pageCount: totalPages, fileName: file.name },
      };
    }

    // Pass 2: render scanned pages to JPEG images
    const pageImages: string[] = [];
    for (let p = 1; p <= pagesToProcess; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d')!;
      // pdfjs-dist v5 requires `canvas` in addition to `canvasContext`
      await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
      // Strip "data:image/jpeg;base64,"; vision.ts pipeline expects raw base64
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      pageImages.push(dataUrl.split(',')[1]);
    }

    return {
      success: true,
      data: {
        type: 'images',
        pageImages,
        pageCount: totalPages,
        fileName: file.name,
      },
    };
  } catch (err: any) {
    if (err?.name === 'PasswordException' || /password/i.test(err?.message ?? '')) {
      return {
        success: false,
        error: { code: 'password_protected', message: 'PDF is password-protected. Please provide an unlocked copy.' },
      };
    }
    if (err?.name === 'InvalidPDFException' || /invalid|corrupt/i.test(err?.message ?? '')) {
      return {
        success: false,
        error: { code: 'corrupted', message: 'PDF file appears to be corrupted or invalid.' },
      };
    }
    return {
      success: false,
      error: { code: 'unknown', message: err?.message ?? 'Failed to process PDF.' },
    };
  }
}

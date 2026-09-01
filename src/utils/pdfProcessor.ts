import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Use local bundled worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type PdfDocumentPromise = ReturnType<typeof pdfjsLib.getDocument>['promise'];
const documentCache = new WeakMap<File, PdfDocumentPromise>();

const getPdfDocument = (file: File): PdfDocumentPromise => {
  const cached = documentCache.get(file);
  if (cached) return cached;

  const loading = file.arrayBuffer()
    .then(arrayBuffer => pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise)
    .catch(error => {
      documentCache.delete(file);
      throw error;
    });
  documentCache.set(file, loading);
  return loading;
};

export const getPdfPageCount = async (file: File): Promise<number> => {
  const pdf = await getPdfDocument(file);
  return pdf.numPages;
};

export const renderPdfPageToImage = async (file: File, pageNumber: number): Promise<Blob> => {
  const pdf = await getPdfDocument(file);
  
  if (pageNumber < 1 || pageNumber > pdf.numPages) {
    throw new Error(`Invalid page number ${pageNumber} for PDF with ${pdf.numPages} pages.`);
  }

  const page = await pdf.getPage(pageNumber);
  
  // Render with scale 2 to get decent quality for OCR
  const viewport = page.getViewport({ scale: 2.0 });
  
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Failed to get 2d context for PDF rendering');
  
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  
  let blob: Blob | null = null;
  try {
    await page.render({
      canvas,
      canvasContext: context,
      viewport,
    }).promise;

    blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.95);
    });
  } finally {
    page.cleanup();
    canvas.width = 0;
    canvas.height = 0;
  }
  
  if (!blob) {
    throw new Error('Failed to convert canvas to blob');
  }

  return blob;
};

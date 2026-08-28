import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Use local bundled worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export const getPdfPageCount = async (file: File): Promise<number> => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  return pdf.numPages;
};

export const renderPdfPageToImage = async (file: File, pageNumber: number): Promise<Blob> => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  
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
  
  await page.render({
    canvas,
    canvasContext: context,
    viewport: viewport,
  }).promise;
  
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.95);
  });
  
  if (!blob) {
    throw new Error('Failed to convert canvas to blob');
  }
  
  return blob;
};

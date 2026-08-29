export const createSha256Hash = async (blob: Blob): Promise<string> => {
  const arrayBuffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

export const checkImageSignature = async (blob: Blob): Promise<'image/jpeg' | 'image/png' | 'image/webp' | null> => {
  const slice = blob.slice(0, 16);
  const buffer = await slice.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  
  if (hex.startsWith('FFD8FF')) return 'image/jpeg';
  if (hex.startsWith('89504E47')) return 'image/png';
  if (hex.startsWith('52494646') && hex.substring(16, 24) === '57454250') return 'image/webp';
  
  return null;
};

export const preprocessImage = async (file: Blob, signal?: AbortSignal, maxSizeBytes: number = 3 * 1024 * 1024): Promise<{ blob: Blob, mimeType: string }> => {
  const actualMime = await checkImageSignature(file);
  if (!actualMime) {
    throw new Error('Unsupported image format. Must be JPEG, PNG, or WebP.');
  }

  // Use createImageBitmap which automatically handles EXIF orientation and is faster
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Failed to decode image.');
  }
  
  if (signal?.aborted) {
    bmp.close();
    throw new DOMException('Aborted', 'AbortError');
  }

  const originalWidth = bmp.width;
  const originalHeight = bmp.height;
  let width = originalWidth;
  let height = originalHeight;
  const MAX_DIMENSION = 4096;

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  // Preserve an already-small PNG without recompressing it. Capture the
  // original dimensions before closing the ImageBitmap; closed bitmaps report
  // zero dimensions in supported browsers.
  if (actualMime === 'image/png' && file.size <= maxSizeBytes && width === originalWidth && height === originalHeight) {
    bmp.close();
    return { blob: file, mimeType: actualMime };
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bmp.close();
    throw new Error('Failed to get canvas context');
  }

  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close();

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  // Every image that needs processing is encoded as JPEG. In particular,
  // canvas ignores quality for PNG, so repeatedly emitting a large PNG could
  // exceed the API limit and make a photo upload fail every time.
  const targetMime = 'image/jpeg';
  let quality = 0.95;
  let resultBlob: Blob | null = null;

  while (quality >= 0.5) {
    resultBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, targetMime, quality);
    });
    
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    if (resultBlob && resultBlob.size <= maxSizeBytes) {
      break;
    }
    quality -= 0.15;
  }

  if (!resultBlob || resultBlob.size > maxSizeBytes) {
    throw new Error('Image is too large after compression. Crop it and try again.');
  }

  return { blob: resultBlob, mimeType: targetMime };
};

export const getCroppedImg = async (
  imageSrc: string,
  pixelCrop: { x: number; y: number; width: number; height: number },
  rotation = 0
): Promise<Blob> => {
  const image = new Image();
  const loadPromise = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
  });
  image.src = imageSrc;
  await loadPromise;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('No 2d context');
  }

  const maxSize = Math.max(image.width, image.height);
  const safeArea = 2 * ((maxSize / 2) * Math.sqrt(2));

  canvas.width = safeArea;
  canvas.height = safeArea;

  ctx.translate(safeArea / 2, safeArea / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.translate(-safeArea / 2, -safeArea / 2);

  ctx.drawImage(
    image,
    safeArea / 2 - image.width / 2,
    safeArea / 2 - image.height / 2
  );

  const data = ctx.getImageData(0, 0, safeArea, safeArea);
  
  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;
  
  ctx.putImageData(
    data,
    Math.round(0 - safeArea / 2 + image.width / 2 - pixelCrop.x),
    Math.round(0 - safeArea / 2 + image.height / 2 - pixelCrop.y)
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob((file) => {
      if (file) resolve(file);
      else reject(new Error('Canvas is empty'));
    }, 'image/jpeg');
  });
};

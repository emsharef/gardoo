const MAX_DIM = 1024;

interface ResizeResult {
  blob: Blob;
  dataUrl: string;
  base64: string;
}

/**
 * Resize an image file to max 1024px on longest side, JPEG 0.85 quality.
 * Returns blob (for R2 upload), dataUrl (for preview), and base64 (for AI identification).
 */
export function resizeImage(file: File): Promise<ResizeResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > MAX_DIM || height > MAX_DIM) {
        if (width > height) {
          height = Math.round(height * (MAX_DIM / width));
          width = MAX_DIM;
        } else {
          width = Math.round(width * (MAX_DIM / height));
          height = MAX_DIM;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      const base64 = dataUrl.replace(/^data:[^;]+;base64,/, "");
      canvas.toBlob(
        (b) => {
          URL.revokeObjectURL(img.src);
          if (!b) {
            reject(new Error("Failed to create blob from canvas"));
            return;
          }
          resolve({ blob: b, dataUrl, base64 });
        },
        "image/jpeg",
        0.85,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error("Failed to load image"));
    };
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Upload a blob to R2 via a presigned URL.
 */
export async function uploadToR2(uploadUrl: string, blob: Blob): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    body: blob,
    headers: { "Content-Type": "image/jpeg" },
  });
  if (!res.ok) {
    throw new Error(`R2 upload failed: ${res.status}`);
  }
}

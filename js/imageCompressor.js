const MIME_BY_FORMAT = {
  webp: "image/webp",
  jpeg: "image/jpeg",
  png: "image/png",
};

async function loadBitmap(file) {
  return createImageBitmap(file, { imageOrientation: "from-image" });
}

export async function compressImage(file, { quality, format, maxDimension }) {
  const bitmap = await loadBitmap(file);
  let { width, height } = bitmap;

  if (maxDimension && Math.max(width, height) > maxDimension) {
    const scale = maxDimension / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  if (format === "jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const mime = MIME_BY_FORMAT[format] || "image/webp";
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
  return blob;
}

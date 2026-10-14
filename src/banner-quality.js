// Check decoded pixels, not provider labels such as "large" or "original".
export function isBannerSharp(image, box) {
  if (!image || !box.width || !box.height) return false;
  const { width, height } = image;
  const density = Math.min(Math.max(box.density || 1, 1), 2);
  return (
    width >= 1920 &&
    height >= 1080 &&
    width / height >= 1.5 &&
    width >= Math.ceil(box.width * density) &&
    height >= Math.ceil(box.height * density)
  );
}

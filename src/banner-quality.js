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
// Reading providers supply panoramic cover art, often shorter than 1080px.
// Keep genuine landscape originals rather than replacing them with a portrait.
export function isReadingBanner(image) {
  return Boolean(
    image && image.width >= 1200 && image.height >= 400 && image.width / image.height >= 1.5,
  );
}

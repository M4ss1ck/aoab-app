/**
 * Decodes an image for upload as a GPU texture.
 *
 * Uses createImageBitmap where available, which does the decode off the main
 * thread. That matters more than it sounds: decoding several multi-megapixel
 * textures with `new Image()` blocks the main thread for seconds on a mid-tier
 * phone, which is the difference between a smooth first paint and a frozen one.
 *
 * Falls back to an HTMLImageElement where createImageBitmap is missing or
 * refuses the source, so the texture still arrives - just more expensively.
 */
export type DecodedImage = ImageBitmap | HTMLImageElement;

export async function decodeImage(url: string): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`${response.status} for ${url}`);
      const blob = await response.blob();
      // Pre-flip. WebGL's UNPACK_FLIP_Y_WEBGL is honoured for an
      // HTMLImageElement but ignored for an ImageBitmap, so without this the
      // bitmap path uploads every texture upside down while the element path
      // looks correct - a difference no unit test will ever notice.
      return await createImageBitmap(blob, { imageOrientation: 'flipY' });
    } catch {
      // Fall through to the element path.
    }
  }

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`failed to load ${url}`));
    image.src = url;
  });
}

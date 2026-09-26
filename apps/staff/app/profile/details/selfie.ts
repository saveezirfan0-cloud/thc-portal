/**
 * The selfie capture's image step (§1.6, §10.1), shared by the profile
 * photo (`PhotoField`) and a photo change request (ADR-0045,
 * `/profile/details/request?kind=photo`), so a requested photo is the same
 * square 512 px JPEG the photos bucket takes (20260927160200: JPEG only,
 * 2 MB) and the office compares like with like.
 */

/** Long edge of the stored image. Generous for a 72 px avatar on a 3× screen. */
export const SELFIE_MAX_EDGE = 512;
export const SELFIE_MIME = 'image/jpeg';
const QUALITY = 0.85;
const MAX_EDGE = SELFIE_MAX_EDGE;
const MIME = SELFIE_MIME;

/**
 * Centre-crop to a square and downscale to `MAX_EDGE`, as JPEG.
 *
 * Square because the avatar is square in the scope rendering and circular
 * in the warm one, and a circle is a square with a radius: cropping here
 * means neither ground has to guess which part of a portrait to show, and
 * the same file works on a timesheet.
 */
export async function squareJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const edge = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(edge, MAX_EDGE);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d context');
  context.drawImage(
    bitmap,
    (bitmap.width - edge) / 2,
    (bitmap.height - edge) / 2,
    edge,
    edge,
    0,
    0,
    size,
    size,
  );
  bitmap.close();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))),
      MIME,
      QUALITY,
    );
  });
}

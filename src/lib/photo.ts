/**
 * Turning a photo from a phone into a member avatar.
 *
 * Avatars are drawn as a circle with `background-size: cover`, so what gets
 * stored only ever needs to be a small square. That matters more than it
 * sounds: a photo straight off a phone is 3–5 MB, base64 inflates it by a
 * third, and Member.photo is a text column that the differ compares on every
 * edit. Storing one raw would put a multi-megabyte string through the sync on
 * each keystroke elsewhere in the app.
 *
 * So the file is centre-cropped to a square, scaled to 256px, and encoded as a
 * JPEG data URI — around 20 KB, which is a reasonable thing to keep in a row
 * and to send over the wire.
 *
 * coverRect is separated out and pure so the crop geometry can be tested with
 * no browser; the canvas work below it cannot be.
 */

/** Longest edge of the stored avatar. Circles this small never want more. */
export const AVATAR_SIZE = 256

/** Refuse anything absurd before decoding it. */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024

export interface CropRect {
  sx: number
  sy: number
  size: number
}

/**
 * The largest centred square inside a `w` × `h` image.
 *
 * Centred rather than top-anchored: a portrait photo cropped from the top
 * gives you a forehead, and these are pictures of people.
 */
export function coverRect(w: number, h: number): CropRect {
  const size = Math.max(1, Math.min(w, h))
  return {
    sx: Math.max(0, Math.round((w - size) / 2)),
    sy: Math.max(0, Math.round((h - size) / 2)),
    size,
  }
}

/** Roughly how many bytes a base64 data URI of `n` raw bytes will occupy. */
export const encodedSize = (n: number) => Math.ceil(n / 3) * 4

/**
 * Decode a file, honouring EXIF rotation.
 *
 * Phone photos are frequently stored sideways with an orientation tag, and a
 * canvas drawn from a raw decode ignores it — which is how you end up with a
 * portrait of somebody lying down. createImageBitmap can apply it; the <img>
 * fallback exists for browsers that lack it (Silk on an Echo Show among them),
 * where the browser applies orientation itself.
 */
async function decode(file: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      /* fall through to the <img> path */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('could not read that image'))
      img.src = url
    })
  } finally {
    // Revoked after decode: the bitmap/image already holds the pixels.
    URL.revokeObjectURL(url)
  }
}

/**
 * A file from an `<input type="file">` → a square JPEG data URI.
 *
 * Throws with a message worth showing rather than returning null, so a caller
 * can put the reason in a toast.
 */
export async function fileToSquareDataUrl(
  file: File,
  size = AVATAR_SIZE,
  quality = 0.82
): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('that is not an image file')
  if (file.size > MAX_INPUT_BYTES) throw new Error('that image is too large')

  const src = await decode(file)
  const { sx, sy, size: srcSize } = coverRect(src.width, src.height)

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('this browser cannot resize images')
  // Without this the downscale aliases badly on a face.
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src as CanvasImageSource, sx, sy, srcSize, srcSize, 0, 0, size, size)

  if ('close' in src && typeof (src as ImageBitmap).close === 'function') (src as ImageBitmap).close()

  // JPEG, not PNG: a PNG of a photograph is several times larger for no gain,
  // and this string is going into a database row.
  return canvas.toDataURL('image/jpeg', quality)
}

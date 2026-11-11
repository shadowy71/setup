import 'server-only';
import sharp from 'sharp';
import { MAX_FILE_BYTES, validateFile } from '@/lib/storage/validation';

const FORMATS = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_EDGE = 2560;
const MAX_PIXELS = 16000000;
const COMPRESS_ABOVE = 2 * 1024 * 1024;

/** Validate actual bytes; strip private metadata and resize only when needed.
 * PDFs never enter sharp. Small images without private metadata stay byte-for-byte
 * unchanged. PNGs remain lossless to protect screenshots and text graphics. */
export async function prepareAttachment({ name, mime, bytes }) {
  if (!validateFile({ name, mime, bytes }).ok) throw Error('invalid_file');
  if (mime === 'application/pdf') return bytes;
  try {
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: MAX_PIXELS, animated: false });
    const metadata = await image.metadata();
    if (metadata.format !== FORMATS[mime] || !metadata.width || !metadata.height || (metadata.pages || 1) !== 1) throw Error();
    // Decode even when no re-encoding is needed, rather than trusting headers.
    await image.clone().resize(1, 1).raw().toBuffer();
    const resize = Math.max(metadata.width, metadata.height) > MAX_EDGE;
    const privateMetadata = Boolean(metadata.exif || metadata.xmp || metadata.iptc || metadata.orientation || metadata.comments?.length);
    const compress = mime !== 'image/png' && bytes.length > COMPRESS_ABOVE;
    if (!resize && !privateMetadata && !compress) return bytes;
    let output = image.rotate();
    if (resize) output = output.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true });
    // No metadata is copied by default. Keep graphics lossless and photographic
    // formats high-quality; preserve the original format and filename contract.
    if (mime === 'image/jpeg') output = output.jpeg({ quality: 95, mozjpeg: true });
    else if (mime === 'image/png') output = output.png({ compressionLevel: 9 });
    else output = output.webp({ quality: 95 });
    const processed = await output.toBuffer();
    if (!processed.length) throw Error();
    if (compress && !resize && !privateMetadata && processed.length > bytes.length * 0.9) return bytes;
    if (processed.length > MAX_FILE_BYTES) throw Error();
    return processed;
  } catch { throw Error('invalid_file'); }
}

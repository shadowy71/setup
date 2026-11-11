/** File transport limits and signature checks. This is not a malware scanner. */
export const MAX_FILE_BYTES = 3 * 1024 * 1024;
const TYPES = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
};
export function validateFile({ name, mime, bytes }) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_FILE_BYTES) return { ok: false, code: 'size' };
  if (typeof name !== 'string' || name.length < 1 || name.length > 180 || /[\x00-\x1f\x7f/\\]/.test(name)) return { ok: false, code: 'name' };
  const ext = name.split('.').pop().toLowerCase();
  if (!TYPES[mime]?.includes(ext)) return { ok: false, code: 'type' };
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  const jpg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  const pdf = bytes.length >= 5 && bytes.toString('ascii', 0, 5) === '%PDF-';
  return ({ 'image/jpeg': jpg, 'image/png': png, 'image/webp': webp, 'application/pdf': pdf })[mime]
    ? { ok: true } : { ok: false, code: 'signature' };
}

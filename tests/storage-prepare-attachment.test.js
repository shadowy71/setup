import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
import { prepareAttachment } from '@/lib/storage/prepare-attachment';

async function image(width, height, format = 'png') {
  return sharp({ create: { width, height, channels: 3, background: '#6390be' } }).toFormat(format).toBuffer();
}
describe('attachment image preparation', () => {
  it('preserves small optimized images without re-encoding', async () => {
    const bytes = await image(100, 80);
    expect(await prepareAttachment({name:'screen.png',mime:'image/png',bytes})).toBe(bytes);
  });
  it('strips private EXIF and honors image orientation', async () => {
    const bytes = await sharp({create:{width:80,height:40,channels:3,background:'#abcdef'}}).jpeg().withMetadata({orientation:6}).toBuffer();
    const result = await prepareAttachment({name:'photo.jpg',mime:'image/jpeg',bytes});
    const metadata = await sharp(result).metadata();
    expect(metadata.width).toBe(40); expect(metadata.height).toBe(80); expect(metadata.exif).toBeUndefined();
  });
  it('resizes unusually large images and keeps PNG graphics lossless', async () => {
    const bytes = await image(3000, 1000);
    const result = await prepareAttachment({name:'graphic.png',mime:'image/png',bytes});
    const metadata = await sharp(result).metadata();
    expect(metadata.format).toBe('png'); expect(metadata.width).toBe(2560); expect(metadata.height).toBe(853);
  });
  it('compresses an oversized photograph only when the saving is meaningful', async () => {
    const raw = randomBytes(1500 * 1200 * 3);
    const bytes = await sharp(raw,{raw:{width:1500,height:1200,channels:3}}).jpeg({quality:100}).toBuffer();
    expect(bytes.length).toBeGreaterThan(2 * 1024 * 1024);
    const result = await prepareAttachment({name:'photo.jpg',mime:'image/jpeg',bytes});
    expect(result.length).toBeLessThan(bytes.length * 0.9);
    expect((await sharp(result).metadata()).width).toBe(1500);
  });
  it('passes PDF bytes untouched and rejects malformed or mismatched images', async () => {
    const pdf = Buffer.from('%PDF-1.4\nexample');
    expect(await prepareAttachment({name:'document.pdf',mime:'application/pdf',bytes:pdf})).toBe(pdf);
    await expect(prepareAttachment({name:'bad.png',mime:'image/png',bytes:Buffer.from('89504e470d0a1a0a','hex')})).rejects.toThrow('invalid_file');
    await expect(prepareAttachment({name:'image.pdf',mime:'application/pdf',bytes:await image(5,5)})).rejects.toThrow('invalid_file');
  });
});

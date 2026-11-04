import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { ImageResponse } from 'next/og';
import { SocialImage } from '@/components/discovery/SocialImage';

describe('dynamic social artwork', () => {
  it('renders a real 1200 by 630 PNG for a long club name', async () => {
    const image = new ImageResponse(createElement(SocialImage, { kind: 'STUDENT ORGANIZATION', title: 'Campus Coding and Robotics Community '.repeat(3), subtitle: 'Technical', initials: 'CC', hue: 180 }), { width: 1200, height: 630 });
    const bytes = Buffer.from(await image.arrayBuffer());
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
  });
});

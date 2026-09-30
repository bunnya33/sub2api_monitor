import { describe, expect, it } from 'vitest';
import { paintUpdateDot } from '../src/main/update-dot';

describe('tray update marker', () => {
  it('paints an opaque red marker with a white edge in the top-right corner', () => {
    const original = Buffer.alloc(32 * 32 * 4);
    const image = paintUpdateDot(original, 32, 32);
    const pixel = (x: number, y: number) => [...image.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4)];
    expect(pixel(26, 6)).toEqual([73, 65, 232, 255]);
    expect(pixel(30, 6)).toEqual([255, 255, 255, 255]);
    expect(pixel(4, 4)).toEqual([0, 0, 0, 0]);
    expect(original.every(value => value === 0)).toBe(true);
  });
});

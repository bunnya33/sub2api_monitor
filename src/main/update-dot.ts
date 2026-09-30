export function paintUpdateDot(pixels: Buffer, width: number, height: number): Buffer {
  const result = Buffer.from(pixels);
  const cx = width - 6, cy = 6;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const distance = Math.hypot(x - cx, y - cy);
      if (distance > 5) continue;
      const offset = (y * width + x) * 4;
      const [red, green, blue] = distance > 3.8 ? [255, 255, 255] : [232, 65, 73];
      result[offset] = blue; result[offset + 1] = green; result[offset + 2] = red; result[offset + 3] = 255;
    }
  }
  return result;
}

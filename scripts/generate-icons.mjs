import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('assets', { recursive: true });
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect x="8" y="8" width="240" height="240" rx="42" fill="#263d38"/><path d="M30 140h48l27-58 39 100 27-53h55" fill="none" stroke="#83cbaa" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const buffer = await sharp(Buffer.from(svg)).resize(256, 256).png().toBuffer();
await writeFile('assets/app.png', buffer);
// ICO wraps a PNG image on Windows; the PNG payload is accepted by Explorer and NotifyIcon.
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico.writeUInt8(0, 6); ico.writeUInt8(0, 7); ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(buffer.length, 14); ico.writeUInt32LE(22, 18);
await writeFile('assets/app.ico', Buffer.concat([ico, buffer]));

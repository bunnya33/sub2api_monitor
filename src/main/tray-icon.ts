import { nativeImage } from 'electron';
import { paintUpdateDot } from './update-dot';

export function trayIcon(base: Electron.NativeImage, hasUpdate: boolean): Electron.NativeImage {
  const icon = base.resize({ width: 32, height: 32 });
  if (!hasUpdate) return icon;
  return nativeImage.createFromBitmap(paintUpdateDot(icon.toBitmap(), 32, 32), { width: 32, height: 32 });
}

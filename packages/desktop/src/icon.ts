import { nativeImage } from "electron";
import { renderDevTentIcon, PULSE_FRAMES } from "./icon-render.js";

export { renderDevTentIcon, PULSE_FRAMES } from "./icon-render.js";

export function createTrayIconFromBuffer(size: number, pulse = 0): Electron.NativeImage {
  const buf = renderDevTentIcon(size, pulse);
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

export function createTrayIcon(pulse = 0): Electron.NativeImage {
  const img = createTrayIconFromBuffer(32, pulse);
  if (process.platform === "win32") {
    return img.resize({ width: 16, height: 16 });
  }
  return img;
}

export function createTrayAnimationFrames(): Electron.NativeImage[] {
  return PULSE_FRAMES.map((p) => createTrayIcon(p));
}

export function createAppIcon(size = 256): Electron.NativeImage {
  const buf = renderDevTentIcon(size, 0);
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

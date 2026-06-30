/**
 * Pure RGBA icon renderer (no Electron — usable in build scripts).
 */

type Rgba = [number, number, number, number];

const NAVY: Rgba = [15, 23, 42, 255];
const NAVY_LIGHT: Rgba = [30, 41, 59, 255];
const LIME: Rgba = [132, 204, 22, 255];
const LIME_BRIGHT: Rgba = [163, 230, 53, 255];
const LIME_DARK: Rgba = [77, 124, 15, 255];
const TENT_DOOR: Rgba = [20, 50, 32, 255];
const MOON: Rgba = [250, 204, 21, 255];
const MOON_GLOW: Rgba = [253, 224, 71, 255];
const PULSE: Rgba = [163, 230, 53, 255];

function mix(a: Rgba, b: Rgba, t: number): Rgba {
  const u = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * u),
    Math.round(a[1] + (b[1] - a[1]) * u),
    Math.round(a[2] + (b[2] - a[2]) * u),
    Math.round(a[3] + (b[3] - a[3]) * u),
  ];
}

function withAlpha(c: Rgba, a: number): Rgba {
  return [c[0], c[1], c[2], Math.round(Math.max(0, Math.min(255, a * 255)))];
}

function blendOver(bg: Rgba, fg: Rgba): Rgba {
  const fa = fg[3] / 255;
  const ba = bg[3] / 255;
  const outA = fa + ba * (1 - fa);
  if (outA <= 0) return [0, 0, 0, 0];
  return [
    Math.round((fg[0] * fa + bg[0] * ba * (1 - fa)) / outA),
    Math.round((fg[1] * fa + bg[1] * ba * (1 - fa)) / outA),
    Math.round((fg[2] * fa + bg[2] * ba * (1 - fa)) / outA),
    Math.round(outA * 255),
  ];
}

function inCircle(x: number, y: number, cx: number, cy: number, r: number): boolean {
  return Math.hypot(x - cx, y - cy) <= r;
}

function tentInside(x: number, y: number): boolean {
  if (y < 8 || y > 27.5) return false;
  const half = (y - 8) * 0.58;
  return x >= 16 - half && x <= 16 + half;
}

function tentLeftPanel(x: number, y: number): boolean {
  return tentInside(x, y) && x <= 16;
}

function tentRightPanel(x: number, y: number): boolean {
  return tentInside(x, y) && x > 16;
}

function tentDoor(x: number, y: number): boolean {
  return x >= 10.2 && x <= 13.4 && y >= 18 && y <= 27.2 && tentLeftPanel(x, y);
}

function moonCrescent(x: number, y: number): boolean {
  return inCircle(x, y, 22.2, 9.8, 3.1) && !inCircle(x, y, 23.9, 9.4, 2.55);
}

function groundLine(x: number, y: number): boolean {
  return y >= 27.3 && y <= 28.1 && x >= 7 && x <= 25;
}

export function renderDevTentIcon(size: number, pulse = 0): Buffer {
  const buf = Buffer.alloc(size * size * 4);
  const scale = size / 32;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const fx = (x + 0.5) / scale;
      const fy = (y + 0.5) / scale;

      const vignette = Math.max(-1, Math.min(1, (fx - 16) * 0.03 + (fy - 16) * 0.02));
      let color: Rgba = mix(NAVY, NAVY_LIGHT, 0.08 + vignette * 0.06);

      if (pulse > 0) {
        const cx = fx - 16;
        const cy = fy - 14;
        const dist = Math.hypot(cx, cy);
        const inner = 10 + pulse * 1.2;
        const outer = 13.5 + pulse * 2;
        if (dist > inner && dist < outer) {
          const mid = (inner + outer) / 2;
          const ring = 1 - Math.abs(dist - mid) / ((outer - inner) / 2);
          color = blendOver(color, withAlpha(PULSE, ring * pulse * 0.55));
        }
      }

      if (moonCrescent(fx, fy)) {
        color = blendOver(color, MOON);
      } else if (inCircle(fx, fy, 22.2, 9.8, 3.4) && pulse > 0) {
        const glow = 1 - Math.hypot(fx - 22.2, fy - 9.8) / 3.4;
        color = blendOver(color, withAlpha(MOON_GLOW, glow * pulse * 0.35));
      }

      if (groundLine(fx, fy)) {
        color = blendOver(color, withAlpha(LIME_DARK, 0.35));
      }

      if (tentRightPanel(fx, fy)) {
        color = blendOver(color, LIME_DARK);
      }
      if (tentLeftPanel(fx, fy)) {
        color = blendOver(color, mix(LIME_BRIGHT, LIME, 0.25));
      }

      if (tentInside(fx, fy) && Math.abs(fx - 16) < 0.42 && fy < 25.5) {
        color = blendOver(color, withAlpha(LIME_DARK, 0.5));
      }

      if (tentDoor(fx, fy)) {
        color = blendOver(color, TENT_DOOR);
      }

      buf[i] = color[0];
      buf[i + 1] = color[1];
      buf[i + 2] = color[2];
      buf[i + 3] = color[3];
    }
  }

  return buf;
}

export const PULSE_FRAMES = [0, 0.25, 0.55, 0.85, 0.55, 0.25];

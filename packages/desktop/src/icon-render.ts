/**
 * Pure RGBA icon renderer (no Electron — usable at runtime for tray animation).
 * Matches the hollow tent + code mark wordmark used in logo-source.png.
 */

type Rgba = [number, number, number, number];

const NAVY: Rgba = [21, 31, 58, 255];
const NAVY_LIGHT: Rgba = [30, 41, 72, 255];
const LIME: Rgba = [132, 204, 22, 255];
const LIME_BRIGHT: Rgba = [194, 243, 60, 255];
const LIME_MID: Rgba = [80, 180, 100, 255];
const LIME_DARK: Rgba = [50, 140, 90, 255];
const MOON: Rgba = [250, 180, 40, 255];
const MOON_GLOW: Rgba = [255, 200, 80, 255];
const STAR: Rgba = [150, 158, 175, 255];
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

/** Distance from point to line segment (ax,ay)-(bx,by). */
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-8) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function tentStroke(x: number, y: number, halfWidth: number): boolean {
  // Peak (16, 6.5), left base (5.5, 25.5), right base (26.5, 25.5)
  // Bottom bar left (5.5, 25.5)-(12.5, 25.5) and right (19.5, 25.5)-(26.5, 25.5) — open doorway
  const peakX = 16;
  const peakY = 6.5;
  const leftX = 5.5;
  const rightX = 26.5;
  const baseY = 25.5;
  const dLeft = distToSegment(x, y, peakX, peakY, leftX, baseY);
  const dRight = distToSegment(x, y, peakX, peakY, rightX, baseY);
  const dBaseL = distToSegment(x, y, leftX, baseY, 12.2, baseY);
  const dBaseR = distToSegment(x, y, 19.8, baseY, rightX, baseY);
  return Math.min(dLeft, dRight, dBaseL, dBaseR) <= halfWidth;
}

function innerChevron(x: number, y: number): boolean {
  // Small ^ near the peak
  const tipX = 16;
  const tipY = 11.2;
  const half = 2.4;
  const botY = tipY + 2.6;
  const dL = distToSegment(x, y, tipX, tipY, tipX - half, botY);
  const dR = distToSegment(x, y, tipX, tipY, tipX + half, botY);
  return Math.min(dL, dR) <= 0.85;
}

function codeGlyph(x: number, y: number): boolean {
  // Simplified </> in the lower tent opening
  const cy = 19.8;
  // <
  const dLt =
    distToSegment(x, y, 13.6, cy, 11.4, cy - 2.4) < 0.75 ||
    distToSegment(x, y, 13.6, cy, 11.4, cy + 2.4) < 0.75;
  // /
  const dSlash = distToSegment(x, y, 14.5, cy + 2.2, 17.5, cy - 2.2) < 0.75;
  // >
  const dGt =
    distToSegment(x, y, 18.4, cy, 20.6, cy - 2.4) < 0.75 ||
    distToSegment(x, y, 18.4, cy, 20.6, cy + 2.4) < 0.75;
  return dLt || dSlash || dGt;
}

function moonCrescent(x: number, y: number): boolean {
  return inCircle(x, y, 23.5, 9.2, 2.9) && !inCircle(x, y, 25.0, 8.6, 2.45);
}

function fourPointStar(x: number, y: number, cx: number, cy: number, r: number): boolean {
  const dx = Math.abs(x - cx);
  const dy = Math.abs(y - cy);
  if (dx + dy > r) return false;
  // Diamond cross: thinner arms
  return dx * 2.2 + dy < r || dy * 2.2 + dx < r;
}

function tentGreenAt(x: number): Rgba {
  // Lime left → teal-green right
  const t = Math.max(0, Math.min(1, (x - 5.5) / 21));
  if (t < 0.45) return mix(LIME_BRIGHT, LIME, t / 0.45);
  return mix(LIME, LIME_DARK, (t - 0.45) / 0.55);
}

export function renderDevTentIcon(size: number, pulse = 0): Buffer {
  const buf = Buffer.alloc(size * size * 4);
  const scale = size / 32;
  const stroke = size >= 48 ? 1.55 : size >= 24 ? 1.7 : 1.85;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const fx = (x + 0.5) / scale;
      const fy = (y + 0.5) / scale;

      const vignette = Math.max(-1, Math.min(1, (fx - 16) * 0.03 + (fy - 16) * 0.02));
      let color: Rgba = mix(NAVY, NAVY_LIGHT, 0.08 + vignette * 0.06);

      if (pulse > 0) {
        const cx = fx - 16;
        const cy = fy - 15;
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
      } else if (inCircle(fx, fy, 23.5, 9.2, 3.3) && pulse > 0) {
        const glow = 1 - Math.hypot(fx - 23.5, fy - 9.2) / 3.3;
        color = blendOver(color, withAlpha(MOON_GLOW, glow * pulse * 0.35));
      }

      if (fourPointStar(fx, fy, 26.2, 26.8, 1.6)) {
        color = blendOver(color, STAR);
      }

      if (tentStroke(fx, fy, stroke)) {
        color = blendOver(color, tentGreenAt(fx));
      }

      if (innerChevron(fx, fy) || codeGlyph(fx, fy)) {
        color = blendOver(color, mix(LIME_BRIGHT, LIME_MID, (fx - 11) / 10));
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

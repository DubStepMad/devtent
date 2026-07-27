export type WindowMode = "setup" | "dashboard";

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_DASHBOARD_SIZE = { width: 1100, height: 720 } as const;
export const DEFAULT_SETUP_SIZE = { width: 500, height: 780 } as const;

/** Whether applying `mode` should change the window geometry. */
export function shouldApplyWindowGeometry(
  previousMode: WindowMode | null,
  nextMode: WindowMode,
  forceLayout = false
): boolean {
  return forceLayout || previousMode !== nextMode;
}

/** Clamp width/height to dashboard minimums (display fitting happens in Electron). */
export function clampDashboardSize(bounds: Pick<WindowBounds, "width" | "height">): {
  width: number;
  height: number;
} {
  return {
    width: Math.max(900, Math.round(bounds.width)),
    height: Math.max(560, Math.round(bounds.height)),
  };
}

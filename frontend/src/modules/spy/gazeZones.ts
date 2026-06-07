import type { RectGazeZone } from "./types.js";


// NOTE: officer face hit comes from IntersectionEngine, not included here

function rectZone(
  id: string,
  label: string,
  kind: RectGazeZone["kind"],
  x: number,
  y: number,
  width: number,
  height: number,
): RectGazeZone {
  return { id, label, kind, x, y, width, height };
}

// configure here
// x, y, width, height -> 0 to 1
export const GAZE_ZONES: RectGazeZone[] = [
  rectZone("desk_file", "Desk File", "evidence", 0.7, 0.65, 0.14, 0.14),
  rectZone("wall_map", "Wall Map", "evidence", 0.65, 0.0, 0.35, 0.5),
  rectZone("monitor_note", "Monitor Note", "evidence", 0.12, 0.5, 0.14, 0.16),
];

// fallback zone when face or evidence zones aren't hit
export const BACKGROUND_ZONE: RectGazeZone = rectZone(
  "background",
  "Background",
  "background",
  0,
  0,
  1,
  1,
);

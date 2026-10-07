export const CANVAS_W = 1600;
export const CANVAS_H = 1000;
export const CELL = 4;
export const GRID_W = CANVAS_W / CELL;
export const GRID_H = CANVAS_H / CELL;
export const BRUSH_RADIUS = 6;

export const ROUND_MS = 2 * 60 * 1000;
export const OVER_MS = 10_000;

export const MAX_FILL_SHARE = 0.5;
export const MIN_FILL_CELLS = 20;
export const MAX_PTS_PER_MSG = 64;
export const MAX_OPS_POINTS = 150_000;
export const NAME_MAX = 20;
export const HISTORY_LIMIT = 50;
export const OP_CHUNK = 100;

export const MODE_ORDER = [
  'paint', 'splat', 'hotzones', 'hill', 'enclose', 'ctf', 'fog', 'eraser', 'shrink', 'teams',
] as const;

/** Slot n (1-based) uses PALETTE[n - 1]. */
export const PALETTE: readonly string[] = [
  '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4',
  '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', '#008080', '#e6beff',
  '#9a6324', '#fffac8', '#800000', '#aaffc3', '#808000', '#ffd8b1',
  '#000075', '#808080', '#ff6f91', '#00c9a7', '#845ec2', '#ffc75f',
];

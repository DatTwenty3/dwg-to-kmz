// "CAD paper" basemaps: a plain dark or white background with a grid, like AutoCAD's model space. The tiles are
// drawn in the browser (custom MapLibre protocol `cadgrid://<theme>/{z}/{x}/{y}`, registered by MapView), so they
// need no network. Each 256-px tile is split 10 × 10 (minor lines) with a major line on its edges, which keeps a
// steady on-screen grid at every zoom, as AutoCAD does.

export type Paper = 'dark' | 'light';

export const GRID_PROTOCOL = 'cadgrid';

export interface GridTheme {
  background: string;
  minor: string;
  major: string;
}

/** AutoCAD 2020+ model space colours (dark) and a plain white sheet (light). */
export const GRID_THEMES: Record<Paper, GridTheme> = {
  dark: { background: '#212830', minor: '#2a323c', major: '#3a4552' },
  light: { background: '#ffffff', minor: '#eef0f3', major: '#d3d8df' },
};

/** Minor divisions per tile side. */
export const GRID_DIVISIONS = 10;

export function gridTileUrl(paper: Paper): string {
  return `${GRID_PROTOCOL}://${paper}/{z}/{x}/{y}`;
}

/** Theme of a `cadgrid://…` tile URL (null when it is not one). */
export function parseGridUrl(url: string): Paper | null {
  const m = /^cadgrid:\/\/(dark|light)\//.exec(url);
  return m ? (m[1] as Paper) : null;
}

/** The subset of CanvasRenderingContext2D the grid needs (keeps this testable without a DOM). */
export interface GridCanvas {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
}

/**
 * Draws one tile of `size` px: background, minor lines every size/10, major lines on the top and left edges (the
 * neighbouring tiles draw the other two, so lines are never doubled). `scale` = device pixels per CSS pixel.
 */
export function drawGridTile(ctx: GridCanvas, size: number, paper: Paper, scale = 1): void {
  const t = GRID_THEMES[paper];
  ctx.fillStyle = t.background;
  ctx.fillRect(0, 0, size, size);
  const step = size / GRID_DIVISIONS;
  const line = (color: string, width: number, positions: number[]) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const p of positions) {
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
    }
    ctx.stroke();
  };
  const minor: number[] = [];
  for (let i = 1; i < GRID_DIVISIONS; i++) minor.push(Math.round(i * step) + 0.5 * scale);
  line(t.minor, scale, minor);
  line(t.major, 1.5 * scale, [0.75 * scale]);
}

/**
 * Colour of an object on this paper. Like AutoCAD's colour 7, white and near-white greys are drawn dark on the white
 * sheet (otherwise they vanish); everything else keeps its colour — pale tints (land-use yellow, pink…) included.
 * Alpha is kept.
 */
export function inkForPaper(c: [number, number, number, number], paper: Paper | undefined): [number, number, number, number] {
  if (paper !== 'light') return c;
  const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const chroma = Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
  return lum >= 200 && chroma <= 24 ? [24, 24, 27, c[3]] : c;
}

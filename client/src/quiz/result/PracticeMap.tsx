/**
 * THE MAP — Luke's 4×4 grid design, with the golfer's practice plotted onto it.
 *
 * Same maths and anchors as the engine, drawn as a light 4×4 grid with the four zones as
 * numbered element tiles on the descending diagonal and the golfer's time rendered as halftone
 * density over the whole plot.
 *
 * THE ENGINE AND THE DESIGN ALREADY AGREE. `ZONE_COORDS` puts Construction at (12, 88),
 * Calibration (40, 64), Transfer (68, 34), Performance (92, 10) — on a 4×4 grid over 0–100
 * those land in exactly the cells the design draws them in, and the danger (80, 80) and
 * comfort (20, 18) corners land in theirs. Nothing about the scoring had to move.
 *
 * ⚠️  AXIS NAMES DIFFER FROM THE HANDOFF. §7 and `config.ts` call the axes "Shot Difficulty"
 *     (x) and "Swing Thoughts" (y); the design calls them ECOLOGY and GUIDANCE. Same two
 *     things — external and internal load — under different names. The design is the newer
 *     artifact so its labels ship here, but this is a rename Luke should confirm rather than
 *     something to settle in a component.
 *
 * STYLING IS SVG ATTRIBUTES, NOT TAILWIND CLASSES, and that is deliberate. `ShareCard`
 * serialises this drawing to a standalone PNG; classes live in a stylesheet the serialised copy
 * can't see, so a class-styled map exported as unstyled black text at default size. Attributes
 * travel with the markup. Same reason colours are threaded through as props rather than
 * inherited via `currentColor`.
 */

import { KERNEL_SIGMA, ZONE_COORDS } from '../../../../shared/practice-dna/config';
import type { HeatKernel, ZoneId } from '../../../../shared/practice-dna/scoring';

/** Plot geometry in SVG px. The plot itself is square: 4 cells of 100. */
const CELL = 100;
const PLOT = CELL * 4;
const PAD = { left: 48, right: 12, top: 24, bottom: 56 };
export const MAP_W = PLOT + PAD.left + PAD.right;
export const MAP_H = PLOT + PAD.top + PAD.bottom;

/**
 * Font stacks are spelled out for the same reason as everything else here: a serialised SVG
 * has no access to the page's fonts, so the exported PNG must name families that exist on
 * the machine doing the rendering.
 */
const SANS = 'ui-sans-serif, system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

export interface MapColors {
  /** Lines, text, halftone. */
  ink: string;
  /** Tile backgrounds, so the halftone doesn't muddy their contents. */
  paper: string;
}

/** On-screen: inherit from the page so the map follows the app's palette. */
const SCREEN_COLORS: MapColors = { ink: 'currentColor', paper: 'var(--color-paper)' };

/** Map coords (0–100, internal load high at top) → SVG px (y grows downward). */
function toPx(x: number, y: number) {
  return {
    px: PAD.left + (x / 100) * PLOT,
    py: PAD.top + ((100 - y) / 100) * PLOT,
  };
}

/** Which cell each zone occupies, derived from the engine rather than hard-coded. */
export function cellOf(zone: ZoneId): { col: number; row: number } {
  const { x, y } = ZONE_COORDS[zone];
  return {
    col: Math.min(3, Math.floor(x / 25)),
    // Row 0 is the top of the grid, which is the HIGH end of internal load.
    row: Math.min(3, Math.floor((100 - y) / 25)),
  };
}

const ZONE_ORDER: readonly ZoneId[] = ['construction', 'calibration', 'transfer', 'performance'];

/** The element-tile symbols from the design. */
const SYMBOL: Record<ZoneId, string> = {
  construction: 'Co',
  calibration: 'Ca',
  transfer: 'T',
  performance: 'P',
};

const ZONE_NAME: Record<ZoneId, string> = {
  construction: 'CONSTRUCTION',
  calibration: 'CALIBRATION',
  transfer: 'TRANSFER',
  performance: 'PERFORMANCE',
};

/**
 * Summed Gaussian heat at a point. Mirrors the same function inside `HalftoneMap` — if a
 * third renderer ever needs it, it should move into the engine rather than be copied again.
 */
export function intensityAt(x: number, y: number, kernels: readonly HeatKernel[]): number {
  let sum = 0;
  for (const k of kernels) {
    const dx = x - k.x;
    const dy = y - k.y;
    sum += k.intensity * Math.exp(-(dx * dx + dy * dy) / (2 * k.sigma * k.sigma));
  }
  return sum;
}

/** Dot spacing in map units. 4 → a 25×25 lattice, dense enough to read as texture. */
const DOT_STEP = 4;
/** Max dot radius in map units, kept under half the spacing so dots never touch. */
const DOT_MAX_R = 1.7;

export interface MapData {
  kernels: HeatKernel[];
  /**
   * Zones the screen is allowed to call starved — `starvedZones()`, not `result.ghostZone` raw.
   * Usually empty or one entry; several when multiple zones are genuinely at 0%.
   */
  starved: readonly ZoneId[];
  /**
   * Percentage of effective weekly time per zone — the SAME numbers the time bars print.
   *
   * Deliberately not `result.zoneIntensity`: that is a 0–1 brightness scale for the glow, and
   * printing it as a percentage put "13%" on the tile while the bar underneath said "20%" for
   * the same zone. Two numbers for one thing on one screen.
   */
  share: Record<ZoneId, number>;
  /**
   * Per-zone effectiveness letter, when the golfer has reached the tier that asks for it.
   *
   * TIME AND QUALITY ARE TWO DIFFERENT MARKS AND THE TILE HAS TO SAY WHICH IS WHICH. A golfer
   * read "Construction 100 A" in the effectiveness list and "6%" on the tile and took them for
   * the same claim disagreeing with itself. They aren't: the letter is how far the golfer sits
   * from the zone's false prior, the percentage is how much of the week goes there. A high grade
   * on a thin slice is the whole diagnosis — understands the zone, barely practises it — so the
   * two belong on the same tile, each labelled, rather than 600px apart and unexplained.
   *
   * Null per zone until its items are answered: they're administered in tier 2, so on a
   * baseline or sharpened read the tiles carry time only.
   */
  grades?: Record<ZoneId, { grade: string | null }> | null;
}

export function mapAriaLabel({ starved, share, grades }: MapData): string {
  const zones = ZONE_ORDER.map((z) => {
    const grade = grades?.[z]?.grade;
    const time = `${ZONE_NAME[z]} ${Math.round(share[z])}% of time`;
    return grade ? `${time}, effectiveness grade ${grade}` : time;
  });

  // Plural when several zones are empty, so the spoken version matches the dashed tiles.
  const names = starved.map((z) => ZONE_NAME[z]);
  const starvedNote =
    names.length === 0
      ? ''
      : names.length === 1
        ? ` ${names[0]} is starved.`
        : ` ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are starved.`;

  return `Your practice on the Map. ${zones.join('. ')}.${starvedNote}`;
}

/**
 * The drawing itself, with no `<svg>` wrapper — so the screen and the share card can frame the
 * same plot differently without a second copy of it.
 *
 * `idPrefix` keeps the arrowhead marker id unique: two maps on one page sharing an id makes the
 * second one's arrows vanish.
 */
export function MapPlot({
  kernels,
  starved,
  share,
  grades,
  colors = SCREEN_COLORS,
  idPrefix = 'pm',
}: MapData & { colors?: MapColors; idPrefix?: string }) {
  const { ink, paper } = colors;

  // Every dot on the lattice, sized by the heat under it. Deterministic — no randomness — so
  // the same run always renders identically.
  const raw: { cx: number; cy: number; heat: number }[] = [];
  let peak = 0;
  for (let x = DOT_STEP / 2; x < 100; x += DOT_STEP) {
    for (let y = DOT_STEP / 2; y < 100; y += DOT_STEP) {
      const heat = intensityAt(x, y, kernels);
      if (heat > peak) peak = heat;
      const { px, py } = toPx(x, y);
      raw.push({ cx: px, cy: py, heat });
    }
  }

  /**
   * Scaled against this golfer's own busiest spot rather than an absolute ceiling.
   *
   * Absolute scaling made the whole map nearly blank for anyone with their time spread thin —
   * a 13%-of-total zone drew a 0.2px dot. The picture's job is showing where time goes
   * *relative to the rest of their practice*; the printed percentages carry the absolute
   * truth. Guard against a zero peak: a golfer with no practice volume at all.
   */
  const dots = raw
    .map((d) => ({
      cx: d.cx,
      cy: d.cy,
      r: (Math.min(1, peak > 0 ? d.heat / peak : 0) * DOT_MAX_R * PLOT) / 100,
    }))
    .filter((d) => d.r > 0.35); // below this it renders as grit, not texture

  const arrowId = `${idPrefix}-arrow`;

  return (
    <>
      <defs>
        <marker
          id={arrowId}
          viewBox="0 0 10 10"
          refX={8}
          refY={5}
          markerWidth={6}
          markerHeight={6}
          orient="auto"
        >
          <path d="M0,1 L9,5 L0,9" fill="none" stroke={ink} strokeWidth={1.5} />
        </marker>
      </defs>

      {/* The design's heavy rule across the top of the grid. */}
      <line
        x1={PAD.left}
        y1={PAD.top - 8}
        x2={PAD.left + PLOT}
        y2={PAD.top - 8}
        stroke={ink}
        strokeWidth={2.5}
      />

      {/* ── Halftone: the golfer's practice ────────────────────────────────── */}
      <g fill={ink} opacity={0.5}>
        {dots.map((d) => (
          <circle key={`${d.cx}-${d.cy}`} cx={d.cx} cy={d.cy} r={d.r} />
        ))}
      </g>

      {/* ── 4×4 grid ───────────────────────────────────────────────────────── */}
      <g stroke={ink} strokeWidth={1} fill="none">
        {[0, 1, 2, 3, 4].map((i) => (
          <line
            key={`v${i}`}
            x1={PAD.left + i * CELL}
            y1={PAD.top}
            x2={PAD.left + i * CELL}
            y2={PAD.top + PLOT}
          />
        ))}
        {[0, 1, 2, 3, 4].map((i) => (
          <line
            key={`h${i}`}
            x1={PAD.left}
            y1={PAD.top + i * CELL}
            x2={PAD.left + PLOT}
            y2={PAD.top + i * CELL}
          />
        ))}
      </g>

      {/* ── Corner labels. Not zones — the two traps the diagonal runs between. ── */}
      <CornerLabel col={3} row={0} lines={['DANGER', 'ZONE']} ink={ink} />
      <CornerLabel col={0} row={3} lines={['COMFORT', 'ZONE']} ink={ink} />

      {/* ── The four zone tiles ───────────────────────────────────────────── */}
      {ZONE_ORDER.map((zone, i) => (
        <ZoneTile
          key={zone}
          zone={zone}
          index={i + 1}
          share={share[zone]}
          grade={grades?.[zone]?.grade ?? null}
          starved={starved.includes(zone)}
          ink={ink}
          paper={paper}
        />
      ))}

      {/* ── Axes ───────────────────────────────────────────────────────────── */}
      <line
        x1={PAD.left - 18}
        y1={PAD.top + PLOT}
        x2={PAD.left - 18}
        y2={PAD.top - 2}
        stroke={ink}
        strokeWidth={1.5}
        markerEnd={`url(#${arrowId})`}
      />
      <line
        x1={PAD.left}
        y1={PAD.top + PLOT + 22}
        x2={PAD.left + PLOT - 4}
        y2={PAD.top + PLOT + 22}
        stroke={ink}
        strokeWidth={1.5}
        markerEnd={`url(#${arrowId})`}
      />

      <text
        x={PAD.left - 30}
        y={PAD.top + PLOT / 2}
        textAnchor="middle"
        transform={`rotate(-90 ${PAD.left - 30} ${PAD.top + PLOT / 2})`}
        fontFamily={SANS}
        fontSize={12}
        letterSpacing="0.1em"
        fill={ink}
      >
        <tspan fontWeight="bold">GUIDANCE</tspan>
        <tspan fontSize={10}> (INTERNAL LOAD)</tspan>
      </text>

      <text
        x={PAD.left + PLOT / 2}
        y={PAD.top + PLOT + 46}
        textAnchor="middle"
        fontFamily={SANS}
        fontSize={12}
        letterSpacing="0.1em"
        fill={ink}
      >
        <tspan fontWeight="bold">ECOLOGY</tspan>
        <tspan fontSize={10}> (EXTERNAL LOAD)</tspan>
      </text>
    </>
  );
}

/** The on-screen map: the plot, framed and captioned. */
export function PracticeMap({ kernels, starved, share, grades }: MapData) {
  const confidenceNote =
    kernels[0]?.sigma === KERNEL_SIGMA.full
      ? 'Fully sharpened.'
      : 'The pattern tightens onto the tiles as you answer more.';

  const hasGrades = grades ? ZONE_ORDER.some((z) => grades[z]?.grade) : false;

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        className="w-full"
        role="img"
        aria-label={mapAriaLabel({ kernels, starved, share, grades })}
      >
        <MapPlot kernels={kernels} starved={starved} share={share} grades={grades} />
      </svg>

      <figcaption className="mt-2 text-sm text-muted">
        Denser shading is where your time goes. {confidenceNote}
        {hasGrades && (
          <>
            {' '}
            Each tile carries two separate marks: the share of your week that goes there, and how
            effective your thinking is in that zone. A high grade on a thin slice means you
            understand that zone but barely practise it.
          </>
        )}
      </figcaption>
    </figure>
  );
}

/** One numbered element tile, inset inside its grid cell. */
function ZoneTile({
  zone,
  index,
  share,
  grade,
  starved,
  ink,
  paper,
}: {
  zone: ZoneId;
  index: number;
  share: number;
  grade: string | null;
  starved: boolean;
  ink: string;
  paper: string;
}) {
  const { col, row } = cellOf(zone);
  const INSET = 6;
  const x = PAD.left + col * CELL + INSET;
  const y = PAD.top + row * CELL + INSET;
  const size = CELL - INSET * 2;

  return (
    <g>
      {/* Paper fill so the halftone doesn't muddy the tile's own contents. */}
      <rect x={x} y={y} width={size} height={size} fill={paper} />
      <rect
        x={x}
        y={y}
        width={size}
        height={size}
        fill="none"
        stroke={ink}
        strokeWidth={2}
        // A starved zone is the headline of a Ghost read — the tile reads as an outline the
        // golfer hasn't filled in yet. This treatment isn't in Luke's drawing; it's the one
        // thing the static design has no way to express.
        strokeDasharray={starved ? '4 3' : undefined}
        opacity={starved ? 0.45 : 1}
      />

      <text x={x + 7} y={y + 15} fontFamily={SANS} fontSize={11} fill={ink} opacity={0.75}>
        {String(index).padStart(2, '0')}
      </text>

      {/* Time share. Labelled, because the letter below it is a different quantity. */}
      <text
        x={x + size - 7}
        y={y + 15}
        textAnchor="end"
        fontFamily={SANS}
        fontSize={11}
        fill={ink}
        opacity={0.75}
      >
        {Math.round(share)}%
        <tspan fontSize={7} letterSpacing="0.08em">
          {' '}
          TIME
        </tspan>
      </text>

      {/* Raised when a grade sits under it, so the two never crowd each other. */}
      <text
        x={x + size / 2}
        y={y + size / 2 + (grade ? 3 : 9)}
        textAnchor="middle"
        fontFamily={SERIF}
        fontSize={34}
        fill={ink}
        opacity={starved ? 0.4 : 1}
      >
        {SYMBOL[zone]}
      </text>

      {grade && (
        <text
          x={x + size / 2}
          y={y + size - 24}
          textAnchor="middle"
          fontFamily={SANS}
          fontSize={10}
          fill={ink}
          opacity={0.8}
        >
          <tspan fontSize={7} letterSpacing="0.08em">
            GRADE{' '}
          </tspan>
          <tspan fontWeight="bold">{grade}</tspan>
        </text>
      )}

      <text
        x={x + size / 2}
        y={y + size - 9}
        textAnchor="middle"
        fontFamily={SANS}
        fontSize={10}
        fontWeight="bold"
        letterSpacing="0.005em"
        fill={ink}
      >
        {ZONE_NAME[zone]}
      </text>
    </g>
  );
}

function CornerLabel({
  col,
  row,
  lines,
  ink,
}: {
  col: number;
  row: number;
  lines: string[];
  ink: string;
}) {
  const cx = PAD.left + col * CELL + CELL / 2;
  const cy = PAD.top + row * CELL + CELL / 2;

  return (
    <text
      x={cx}
      y={cy - (lines.length - 1) * 6}
      textAnchor="middle"
      fontFamily={SANS}
      fontSize={11}
      fontWeight="bold"
      letterSpacing="0.06em"
      fill={ink}
      opacity={0.8}
    >
      {lines.map((line, i) => (
        <tspan key={line} x={cx} dy={i === 0 ? 0 : 13}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

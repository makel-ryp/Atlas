/**
 * THE SHARE CARD — the golfer's own Map, as a picture they can keep.
 *
 * This is the same `MapPlot` the result screen draws, framed with the archetype name, the
 * Messy Middle share, and a wordmark so the image explains itself once it leaves the page.
 * Previously the card was `HalftoneMap`, a different dot-grid drawing: a golfer studied the
 * 4×4 grid all the way down the result and then got handed something that looked unrelated.
 * One diagnosis, one picture.
 *
 * Colours and fonts are explicit hex and named families rather than inherited, because the
 * export path serialises this SVG away from the page — see `PracticeMap`'s note. Anything
 * relying on a stylesheet would come out unstyled.
 */

import { useRef, useState } from 'react';
import { MAP_H, MAP_W, type MapData, MapPlot, mapAriaLabel } from './PracticeMap';
import { svgToPng } from './svgToPng';

/**
 * The book-cover palette, hard-coded on purpose. A shared image has no page to inherit from,
 * and a share card that renders differently depending on who opened it isn't a share card.
 * Kept in step with `client/src/index.css` by hand.
 */
const INK = '#1a1a1a';
const PAPER = '#f5efe6';
const MUTED = '#8a8175';

/** Room above the plot for the title block, and below it for the wordmark. */
const HEADER = 96;
const FOOTER = 44;
const CARD_W = MAP_W;
const CARD_H = MAP_H + HEADER + FOOTER;

/** Exported at 2× so the PNG still looks sharp pasted into a message or a slide. */
const EXPORT_SCALE = 2;

type ExportState = 'idle' | 'working' | 'shared' | 'downloaded' | 'failed';

function filenameFor(archetype: string): string {
  const slug = archetype.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `practice-dna-${slug || 'map'}.png`;
}

export function ShareCard({
  archetype,
  messyShare,
  confidenceNote,
  ...map
}: MapData & {
  /** Display name, e.g. "The Quick-Fix Junkie". */
  archetype: string;
  /** Percent of effective time with no declared focus. */
  messyShare: number;
  /** One short line under the title — what level of read this is. */
  confidenceNote: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [state, setState] = useState<ExportState>('idle');

  async function handleShare() {
    const svg = svgRef.current;
    if (!svg) return;

    setState('working');
    try {
      const blob = await svgToPng(svg, {
        width: CARD_W,
        height: CARD_H,
        background: PAPER,
        scale: EXPORT_SCALE,
      });
      const file = new File([blob], filenameFor(archetype), { type: 'image/png' });

      /**
       * Prefer the OS share sheet when it can actually take a file — on a phone that's the
       * difference between "saved to downloads somewhere" and landing straight in a message.
       * `canShare` must be checked with the file: Safari exposes `share` but refuses files.
       */
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `My Practice DNA — ${archetype}` });
        setState('shared');
        return;
      }

      // Otherwise download it. Revoking on the next tick rather than immediately: Safari
      // cancels an in-flight download if the URL dies too soon.
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filenameFor(archetype);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setState('downloaded');
    } catch (e) {
      // AbortError means the golfer dismissed the share sheet. That isn't a failure and
      // shouldn't show an error.
      if (e instanceof Error && e.name === 'AbortError') {
        setState('idle');
        return;
      }
      setState('failed');
    }
  }

  const canUseShareSheet = typeof navigator !== 'undefined' && 'canShare' in navigator;

  return (
    <div>
      {/* The card itself. Everything inside the SVG so the exported PNG is self-contained. */}
      <svg
        ref={svgRef}
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${CARD_W} ${CARD_H}`}
        width={CARD_W}
        height={CARD_H}
        className="h-auto w-full rounded-lg border border-ink/15"
        role="img"
        aria-label={`Share card. ${archetype}. ${mapAriaLabel(map)}`}
      >
        <rect width={CARD_W} height={CARD_H} fill={PAPER} />

        <text
          x={PAD_X}
          y={38}
          fontFamily={CARD_SANS}
          fontSize={11}
          fontWeight="bold"
          letterSpacing="0.2em"
          fill={MUTED}
        >
          PRACTICE DNA
        </text>

        <text x={PAD_X} y={70} fontFamily={CARD_SANS} fontSize={26} fontWeight="bold" fill={INK}>
          {archetype}
        </text>

        <text x={PAD_X} y={88} fontFamily={CARD_SANS} fontSize={12} fill={MUTED}>
          {Math.round(messyShare)}% Messy Middle · {confidenceNote}
        </text>

        {/* The same plot the result screen shows, shifted down under the title block. */}
        <g transform={`translate(0 ${HEADER})`}>
          <MapPlot {...map} colors={{ ink: INK, paper: PAPER }} idPrefix="share" />
        </g>

        <text
          x={CARD_W / 2}
          y={CARD_H - 16}
          textAnchor="middle"
          fontFamily={CARD_SANS}
          fontSize={11}
          fill={MUTED}
        >
          rypgolf.com — find your Practice DNA
        </text>
      </svg>

      <button
        type="button"
        onClick={handleShare}
        disabled={state === 'working'}
        className="mt-4 w-full rounded-lg bg-ink px-5 py-3 font-medium text-paper disabled:opacity-40"
      >
        {state === 'working'
          ? 'Preparing…'
          : canUseShareSheet
            ? 'Share my map'
            : 'Download my map'}
      </button>

      <p className="mt-2 min-h-5 text-center text-sm text-muted" role="status">
        {state === 'downloaded' && 'Saved as a PNG.'}
        {state === 'shared' && 'Shared.'}
        {state === 'failed' && "Couldn't create the image. Try again, or screenshot the card."}
      </p>
    </div>
  );
}

const PAD_X = 24;
const CARD_SANS =
  'ui-sans-serif, system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';

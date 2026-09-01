/**
 * SVG element → PNG blob, in the browser.
 *
 * Lifted out of `ShareCard` when the result PDF needed the same trick: the card exports itself
 * as an image, and the PDF embeds the Map as one. Two copies of this dance would have been two
 * places to rediscover the two non-obvious parts below.
 *
 * Whatever is passed in must be self-contained — explicit `fill`/`stroke` and named font
 * families, not inherited CSS. Serialising an element away from the page drops every
 * stylesheet, so anything relying on `currentColor` or a CSS variable comes out unstyled.
 * `MapPlot` takes a `colors` prop for exactly this reason.
 */

export interface RasterOptions {
  /** The SVG's own coordinate width. Output is this × `scale`. */
  width: number;
  height: number;
  /**
   * Painted before the image. PNG is transparent by default, which reads as broken anywhere
   * the viewer's background is dark — and inside a PDF it shows the page through the Map.
   */
  background: string;
  /** 2× keeps it sharp in a message, a slide, or a printed PDF page. */
  scale?: number;
}

export async function svgToPng(
  svg: SVGSVGElement | string,
  { width, height, background, scale = 2 }: RasterOptions,
): Promise<Blob> {
  const source = typeof svg === 'string' ? svg : new XMLSerializer().serializeToString(svg);

  /**
   * The data URL matters. A blob URL taints the canvas in some browsers, and `toBlob` then
   * throws a security error rather than returning an image.
   */
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not rasterise the SVG'));
    img.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas context');

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas produced no image'))),
      'image/png',
    );
  });
}

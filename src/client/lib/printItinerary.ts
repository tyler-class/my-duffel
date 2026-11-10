// Print = a PDF of the itinerary, everywhere: phones get the share sheet (Print, Save to Files,
// AirDrop, Mail…), computers open it in a new tab to print or save. One flow, because the
// installed iPhone app can't print a web page at all.
import regularUrl from '../assets/fonts/Geist-Regular.ttf?url';
import boldUrl from '../assets/fonts/Geist-SemiBold.ttf?url';
import type { Printable } from './itineraryPdf';

let loading: Promise<{
  builder: typeof import('./itineraryPdf');
  fonts: { regular: Uint8Array; bold: Uint8Array };
}> | null = null;

const bytes = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error('Couldn’t load the font for the PDF.');
    return r.arrayBuffer().then((b) => new Uint8Array(b));
  });

/** The PDF maker and its fonts (fetched once). Call early so a tap can share straight away. */
export function preparePdf() {
  loading ??= Promise.all([import('./itineraryPdf'), bytes(regularUrl), bytes(boldUrl)]).then(
    ([builder, regular, bold]) => ({ builder, fonts: { regular, bold } }),
  );
  loading.catch(() => (loading = null));
  return loading;
}

/** Phones and tablets: share the file. Computers: open it. */
export const sharesPdf = () =>
  window.matchMedia('(pointer: coarse)').matches && typeof navigator.share === 'function';

/**
 * On a computer, open the tab during the click itself (browsers block tabs opened later), and
 * fill it once the PDF is ready.
 */
export function openPdfTab(): Window | null {
  if (sharesPdf()) return null;
  const w = window.open('', '_blank');
  if (w) w.document.title = 'Making PDF…';
  return w;
}

/** The itinerary as a PDF file. */
export async function itineraryPdf(data: Printable): Promise<File> {
  const { builder, fonts } = await preparePdf();
  const pdf = await builder.buildItineraryPdf(data, fonts, builder.paperFor(navigator.language));
  return new File([pdf as BlobPart], builder.itineraryFileName(data.trip.name), {
    type: 'application/pdf',
  });
}

/**
 * Hands the PDF over. 'shared' / 'opened' when done, 'cancelled' if the share sheet was closed,
 * 'needs-tap' when the browser wants a fresh tap before sharing (iOS after a slow build).
 */
export async function deliverPdf(
  file: File,
  tab: Window | null = null,
): Promise<'shared' | 'opened' | 'cancelled' | 'needs-tap'> {
  if (sharesPdf() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name.replace(/\.pdf$/, '') });
      return 'shared';
    } catch (e) {
      const name = (e as Error)?.name;
      if (name === 'AbortError') return 'cancelled';
      if (name === 'NotAllowedError') return 'needs-tap';
      throw e;
    }
  }
  const url = URL.createObjectURL(file);
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  const w = tab && !tab.closed ? tab : window.open(url, '_blank');
  if (w === tab && w) w.location.href = url;
  if (!w) {
    // Pop-ups blocked: save it instead.
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
  }
  return 'opened';
}

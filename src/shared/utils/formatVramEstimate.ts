/**
 * Formats a catalogue VRAM estimate for display next to an engine name.
 *
 * Why this exists: the registry stores `vramEstimate` as megabytes with a tilde (`~1629 MB`) because
 * that is how it was measured, but the model list has to show 0.7 GB to 31 GB in one 10 px line.
 * Printing megabytes makes a 1.6 GB model read as `~1629 MB` — four digits of false precision for a
 * number that is an estimate of need, not a measurement of the device.
 *
 * @param estimate - Catalogue estimate, e.g. `~1629 MB`, `~711 MB`, `0 MB`, or an already-GB value.
 * @returns Compact label, e.g. `~1.6 GB`, `~711 MB`, `0 MB`, or the input when it cannot be parsed.
 */
export function formatVramEstimate(estimate?: string): string {
  if (!estimate) return '';

  const match = /^(~)?\s*(\d+(?:\.\d+)?)\s*(MB|GB)$/i.exec(estimate.trim());
  if (!match) return estimate.trim();

  const tilde = match[1] ?? '';
  const value = Number(match[2]);
  const unit = match[3].toUpperCase();
  const megabytes = unit === 'GB' ? value * 1024 : value;

  // 1000, not 1024: the catalogue stores whole megabytes, so a 1001 MB entry is a rounded gigabyte
  // and printing `~1001 MB` next to `~2.2 GB` reads as a different unit system on the same list.
  if (megabytes < 1000) return `${tilde}${Math.round(megabytes)} MB`;

  const gigabytes = megabytes / 1024;
  // One decimal below 10 GB, none above: `~31 GB` is as precise as a 31 GB estimate deserves, while
  // `~1.6 GB` and `~4.4 GB` still differ from their neighbours in the list.
  const rounded = gigabytes < 10 ? Math.round(gigabytes * 10) / 10 : Math.round(gigabytes);
  return `${tilde}${rounded} GB`;
}

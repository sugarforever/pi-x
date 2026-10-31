/** Only split complete, explicitly numbered threads; ordinary prose stays intact. */
export function draftParts(text: string): string[] | null {
  const markers = [...text.matchAll(/^(\d+)\/(\d+)[ \t]+/gm)];
  if (markers.length < 2 || text.slice(0, markers[0].index).trim()) return null;
  const total = Number(markers[0][2]);
  if (
    total !== markers.length ||
    markers.some((m, i) => Number(m[1]) !== i + 1 || Number(m[2]) !== total)
  )
    return null;
  const parts = markers.map((m, i) =>
    text.slice(m.index! + m[0].length, markers[i + 1]?.index ?? text.length).trim(),
  );
  return parts.every(Boolean) ? parts : null;
}

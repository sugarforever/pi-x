import type { WritingSample } from '../shared/types';
export function selectSamples(query: string, samples: WritingSample[]): WritingSample[] {
  const words = query
    .toLowerCase()
    .split(/[\s\p{P}]+/u)
    .filter(Boolean);
  return samples
    .map((sample, index) => ({
      sample,
      index,
      score: words.reduce(
        (n, w) => n + (`${sample.title} ${sample.text}`.toLowerCase().includes(w) ? 1 : 0),
        0,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 5)
    .map(({ sample }) => ({ ...sample, text: sample.text.slice(0, 2400) }));
}

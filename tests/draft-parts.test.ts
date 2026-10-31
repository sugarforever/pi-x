import { expect, it } from 'vitest';
import { draftParts } from '../src/sidepanel/draft-parts';
it('recognizes an explicitly numbered thread', () => {
  expect(draftParts('1/2 First post\n\n2/2 Second post')).toEqual(['First post', 'Second post']);
});
it('does not split ordinary paragraphs or inconsistent numbering', () => {
  expect(draftParts('First paragraph\n\nSecond paragraph')).toBeNull();
  expect(draftParts('1/3 First\n\n2/3 Second')).toBeNull();
});

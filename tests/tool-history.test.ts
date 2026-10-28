// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { renderToolHistory } from '../src/sidepanel/tool-history';
it('keeps history collapsed by default and renders results as text', () => {
  const history = renderToolHistory(
    [
      {
        id: '1',
        name: 'read_article',
        arguments: '{"url":"https://example.com"}',
        status: 'error',
        startedAt: 0,
        finishedAt: 1000,
        output: '<script>alert(1)</script>',
      },
    ],
    new Set(),
  );
  expect(history.open).toBe(false);
  expect(history.querySelector('details')?.open).toBe(false);
  expect(history.textContent).toContain('1.0s');
  expect(history.querySelector('pre:last-child')?.textContent).toBe('<script>alert(1)</script>');
  expect(history.querySelector('script')).toBeNull();
});
it('restores expanded calls when refreshing results', () => {
  const history = renderToolHistory(
    [{ id: '1', name: 'web_search', arguments: '{}', status: 'running', startedAt: 0 }],
    new Set(['all', '1']),
  );
  expect(history.open).toBe(true);
  expect(history.querySelector('details')?.open).toBe(true);
});
it('keeps expansion independent between conversation rounds', () => {
  const traces = [
    { id: 'call', name: 'web_search', arguments: '{}', status: 'done' as const, startedAt: 0 },
  ];
  const expanded = new Set(['round-1']);
  expect(renderToolHistory(traces, expanded, 'round-1').open).toBe(true);
  expect(renderToolHistory(traces, expanded, 'round-2').open).toBe(false);
});

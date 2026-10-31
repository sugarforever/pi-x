// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { renderMarkdown } from '../src/sidepanel/markdown';
it('renders rich Markdown and native math without treating code as markup', () => {
  const host = document.createElement('div');
  renderMarkdown(
    host,
    '## Approach\n\n**Given** and *reasoning*\n\n1. First\n   - Nested\n2. Second\n\n| Side | Length |\n| --- | --- |\n| AB | 6 |\n\n> Use symmetry.\n\n```python\nprint("<script>")\n```\n\nInline \\(x^2\\) and $y_1$.\n\n$$\n\\frac{a}{b}=2\n$$',
  );
  expect(host.querySelector('h2')?.textContent).toBe('Approach');
  expect(host.querySelector('strong')?.textContent).toBe('Given');
  expect(host.querySelector('em')?.textContent).toBe('reasoning');
  expect(host.querySelector('ol ul li')?.textContent).toBe('Nested');
  expect(host.querySelector('table tbody td')?.textContent).toBe('AB');
  expect(host.querySelector('pre code')?.textContent).toContain('print("<script>")');
  expect(host.querySelectorAll('math')).toHaveLength(3);
  expect(host.querySelector('.math-block mfrac')).not.toBeNull();
  expect(host.querySelector('script')).toBeNull();
});
it('keeps raw HTML, unsafe links, remote images and math commands inert', () => {
  const host = document.createElement('div');
  renderMarkdown(
    host,
    '<img src=x onerror=alert(1)>\n\n[bad](javascript:alert%281%29) ![remote](https://example.org/image.png) [good](https://example.org)\n\n$\\href{javascript:alert(1)}{bad}$ $\\includegraphics{https://example.org/image.png}$',
  );
  expect(host.querySelector('img,script,iframe')).toBeNull();
  expect(host.querySelectorAll('a')).toHaveLength(1);
  expect(host.querySelector('a')?.rel).toBe('noopener noreferrer');
  expect(host.querySelector('a')?.target).toBe('_blank');
  expect(host.textContent).toContain('<img src=x');
});
it('handles incomplete output and currency without errors', () => {
  const host = document.createElement('div');
  renderMarkdown(host, 'Cost $5 or $10.\n\n```python\n**unfinished');
  expect(host.querySelector('math')).toBeNull();
  expect(host.querySelector('pre code')?.textContent).toContain('**unfinished');
  renderMarkdown(host, '\\[\\sqrt{9}=3\\]');
  expect(host.querySelector('math msqrt')).not.toBeNull();
});

it('keeps deeply nested math readable when the math engine rejects it', () => {
  const host = document.createElement('div');
  const formula = '{'.repeat(1900) + 'x' + '}'.repeat(1900);
  expect(() => renderMarkdown(host, 'Before $' + formula + '$ after.')).not.toThrow();
  expect(host.textContent).toContain(formula);
  expect(host.textContent).toContain('after.');
});
it('does not end a formula at an escaped dollar sign', () => {
  const host = document.createElement('div');
  renderMarkdown(host, String.raw`Cost: $\text{Price: \$5}$ and $x+\$y$.`);
  expect(host.querySelectorAll('math')).toHaveLength(2);
  expect(host.querySelector('annotation')?.textContent).toBe(String.raw`\text{Price: \$5}`);
});

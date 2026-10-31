import MarkdownIt from 'markdown-it';
import katex from 'katex';
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });
markdown.validateLink = (url) => /^https?:\/\//i.test(url) && URL.canParse(url);
markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noopener noreferrer');
  return renderer.renderToken(tokens, index, options);
};
// Do not fetch image URLs supplied by model output or page content.
markdown.renderer.rules.image = (tokens, index) =>
  `<span class="markdown-image-alt">${markdown.utils.escapeHtml(tokens[index].content)}</span>`;
markdown.renderer.rules.table_open = () => '<div class="markdown-table"><table>';
markdown.renderer.rules.table_close = () => '</table></div>\n';
function math(source: string, displayMode: boolean) {
  try {
    return katex.renderToString(source, {
      output: 'mathml',
      displayMode,
      throwOnError: false,
      trust: false,
      strict: 'ignore',
      maxExpand: 200,
      maxSize: 10,
    });
  } catch {
    return `<code class="math-fallback">${markdown.utils.escapeHtml(source)}</code>`;
  }
}
function delimiter(source: string, close: string, start: number) {
  let end = source.indexOf(close, start);
  while (end >= 0) {
    let slashes = 0;
    for (let i = end - 1; i >= 0 && source[i] === '\\'; i--) slashes++;
    if (slashes % 2 === 0) return end;
    end = source.indexOf(close, end + close.length);
  }
  return -1;
}
markdown.inline.ruler.before('escape', 'math_inline', (state, silent) => {
  const start = state.pos;
  const open = state.src.startsWith('\\(', start)
    ? '\\('
    : state.src.startsWith('\\[', start)
      ? '\\['
      : state.src[start] === '$' && state.src[start + 1] !== '$'
        ? '$'
        : undefined;
  if (!open || (open === '$' && /\s/.test(state.src[start + 1] || ' '))) return false;
  const close = open === '\\(' ? '\\)' : open === '\\[' ? '\\]' : '$';
  const end = delimiter(state.src, close, start + open.length);
  if (
    end < 0 ||
    end - start > 4000 ||
    (open === '$' && (/\s/.test(state.src[end - 1]) || /\d/.test(state.src[end + 1] || '')))
  )
    return false;
  if (!silent) {
    const token = state.push('math_inline', '', 0);
    token.content = state.src.slice(start + open.length, end);
    token.meta = { display: open === '\\[' };
  }
  state.pos = end + close.length;
  return true;
});
markdown.renderer.rules.math_inline = (tokens, index) =>
  `<span class="math-inline">${math(tokens[index].content, !!tokens[index].meta?.display)}</span>`;
markdown.block.ruler.before('fence', 'math_block', (state, start, end, silent) => {
  const first = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
  const open = first.startsWith('$$') ? '$$' : first.startsWith('\\[') ? '\\[' : undefined;
  if (!open) return false;
  const close = open === '$$' ? '$$' : '\\]';
  let content = first.slice(open.length),
    last = start;
  while (delimiter(content, close, 0) < 0 && last + 1 < end && content.length <= 4000) {
    last++;
    content += '\n' + state.src.slice(state.bMarks[last] + state.tShift[last], state.eMarks[last]);
  }
  const stop = delimiter(content, close, 0);
  if (stop < 0 || stop > 4000 || content.slice(stop + close.length).trim()) return false;
  if (silent) return true;
  {
    const token = state.push('math_block', '', 0);
    token.content = content.slice(0, stop).trim();
    token.block = true;
    token.map = [start, last + 1];
  }
  state.line = last + 1;
  return true;
});
markdown.renderer.rules.math_block = (tokens, index) =>
  `<div class="math-block">${math(tokens[index].content, true)}</div>\n`;
export function renderMarkdown(host: HTMLElement, source: string) {
  host.classList.add('markdown-body');
  // HTML input is disabled; all generated markup comes from the parser and
  // bounded, untrusted-mode math renderer above, never from model HTML.
  host.innerHTML = markdown.render(source);
}

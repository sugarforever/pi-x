// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { DiagramViewer } from '../src/sidepanel/diagram-view';
import { commitDiagram } from '../src/background/diagrams';
const triangle = {
  dimension: 2,
  title: 'Triangle ABC',
  points: [
    { id: 'A', at: [0, 0] },
    { id: 'B', at: [6, 0] },
    { id: 'C', at: [0, 8] },
  ],
  segments: [
    { a: 'A', b: 'B', label: '6' },
    { a: 'B', b: 'C' },
    { a: 'C', b: 'A' },
  ],
  angles: [{ points: ['B', 'A', 'C'], label: '90°' }],
};
it('renders validated geometry and exposes expanded, export and label controls without interpreting HTML', () => {
  const host = document.createElement('section');
  const actions: any[] = [];
  const expand = vi.fn();
  const view = new DiagramViewer(
    host,
    (a) => {
      actions.push(a);
    },
    expand,
  );
  const doc = commitDiagram(
    undefined,
    { ...triangle, title: '<img src=x onerror=alert(1)>' },
    'first',
  );
  view.update(doc, false);
  expect(host.querySelector('svg[role="img"]')).not.toBeNull();
  expect(host.querySelectorAll('line')).toHaveLength(3);
  expect(host.textContent).toContain('90°');
  expect(host.querySelector('img')).toBeNull();
  expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
  const label = host.querySelector('[aria-label="Move label A"]')!;
  label.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  expect(actions[0]).toMatchObject({
    action: 'diagram',
    operation: 'label',
    versionId: 'first',
    point: 'A',
    offset: [16, -12],
  });
  (host.querySelector('[aria-label="Expand diagram"]') as HTMLButtonElement).click();
  expect(expand).toHaveBeenCalledOnce();
  expect(view.svgText()).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(view.svgText()).not.toContain('<img');
});
it('renders a rotatable solid, changes projection with view controls, and restores its original view', () => {
  const host = document.createElement('section');
  const view = new DiagramViewer(host, () => {});
  view.update(
    commitDiagram(
      undefined,
      { dimension: 3, solids: [{ id: 'box', kind: 'cube', size: [4, 4, 4] }] },
      'cube',
    ),
    false,
  );
  expect(host.dataset.dimension).toBe('3');
  const initial = host.querySelector('svg')!.innerHTML;
  (host.querySelector('[aria-label="Rotate right"]') as HTMLButtonElement).click();
  expect(host.querySelector('svg')!.innerHTML).not.toBe(initial);
  (host.querySelector('[aria-label="Reset diagram view"]') as HTMLButtonElement).click();
  expect(host.querySelector('svg')!.innerHTML).toBe(initial);
});
it('offers bounded version history and locks mathematical edits while a request runs', () => {
  const host = document.createElement('section'),
    actions: any[] = [];
  const view = new DiagramViewer(host, (a) => {
    actions.push(a);
  });
  const doc = commitDiagram(
    commitDiagram(undefined, triangle, 'a'),
    {
      ...triangle,
      title: 'With a midpoint',
      points: [...triangle.points, { id: 'M', midpoint: ['B', 'C'] }],
    },
    'b',
  );
  view.update(doc, true);
  expect((host.querySelector('[aria-label="Diagram version"]') as HTMLSelectElement).disabled).toBe(
    true,
  );
  view.update(doc, false);
  (host.querySelector('[aria-label="Undo diagram"]') as HTMLButtonElement).click();
  expect(actions[0]).toMatchObject({ action: 'diagram', operation: 'select', versionId: 'a' });
});
it('cancels a label gesture when another diagram version replaces its starting state', () => {
  const host = document.createElement('section'),
    actions: any[] = [];
  const view = new DiagramViewer(host, (a) => {
    actions.push(a);
  });
  const first = commitDiagram(undefined, triangle, 'first');
  view.update(first, false);
  const svg = host.querySelector('svg')!;
  svg.setPointerCapture = () => {};
  const event = (name: string) => {
    const e = new MouseEvent(name, { bubbles: true, button: 0, clientX: 10, clientY: 10 });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    return e;
  };
  host.querySelector('[data-point="A"]')!.dispatchEvent(event('pointerdown'));
  view.update(commitDiagram(first, { ...triangle, title: 'Another diagram' }, 'second'), false);
  svg.dispatchEvent(event('pointerup'));
  expect(actions).toEqual([]);
});

it('gives point labels a padded grab target and describes exactly what can move', () => {
  const host = document.createElement('section');
  const view = new DiagramViewer(host, () => {});
  view.update(commitDiagram(undefined, triangle, 'first'), false);
  const label = host.querySelector('[aria-label="Move label A"]')!;
  expect(label.tagName.toLowerCase()).toBe('g');
  expect(label.querySelector('rect[width="28"][height="28"]')).not.toBeNull();
  expect(label.querySelector('title')?.textContent).toMatch(/drag.*arrow keys/i);
  expect(host.querySelector('.diagram-note')?.textContent).toMatch(/point-name labels.*A.*B/i);
});

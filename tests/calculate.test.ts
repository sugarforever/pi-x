import { expect, it } from 'vitest';
import { calculate } from '../src/geometry/calculate';
import { resolveScene } from '../src/geometry/kernel';
it('computes constrained AMC triangle and circumcenter using named expressions', () => {
  const n = calculate([
    { name: 't', expression: '10*cos(130)+sqrt(18^2-10^2*sin(130)^2)' },
    { name: 'cx', expression: 't*cos(130)' },
    { name: 'cy', expression: 't*sin(130)' },
    { name: 'oy', expression: '(t^2-10*cx)/(2*cy)' },
    { name: 'r', expression: 'hypot(5,oy)' },
  ]);
  const scene = resolveScene({
    dimension: 2,
    points: [
      { id: 'A', at: [10, 0] },
      { id: 'B', at: [0, 0] },
      { id: 'C', at: [n.cx, n.cy] },
      { id: 'O', at: [5, n.oy] },
    ],
    circles: [{ center: 'O', radius: n.r }],
    constraints: [
      { kind: 'distance', a: 'A', b: 'B', value: 10 },
      { kind: 'distance', a: 'A', b: 'C', value: 18 },
      { kind: 'angle', points: ['A', 'B', 'C'], value: 130 },
      {
        kind: 'equal',
        lines: [
          ['O', 'A'],
          ['O', 'B'],
        ],
      },
      {
        kind: 'equal',
        lines: [
          ['O', 'B'],
          ['O', 'C'],
        ],
      },
    ],
  });
  expect(scene.points.C[0]).toBeLessThan(0);
  expect(n.cy).toBeGreaterThan(0);
});
it('uses standard arithmetic precedence and degree-based trig', () => {
  expect(
    calculate([
      { name: 'a', expression: '-2^2+2*3' },
      { name: 'b', expression: 'acos(0)+atan2(1,0)' },
    ]),
  ).toEqual({ a: 2, b: 180 });
});
it('rejects code, arbitrary property access, unknown names, and nonfinite output', () => {
  for (const expression of [
    'globalThis.fetch("https://example.com")',
    'constructor.constructor(1)',
    '1/0',
    'sqrt(-1)',
    'unknown+3',
    'x=2',
    '2;3',
  ])
    expect(() => calculate([{ name: 'x', expression }])).toThrow();
  expect(() => calculate([{ name: 'constructor', expression: '2' }])).toThrow();
  expect(() =>
    calculate([{ name: 'x', expression: '('.repeat(200) + '1' + ')'.repeat(200) }]),
  ).toThrow();
});

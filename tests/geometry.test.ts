import { describe, it, expect } from 'vitest';
import { resolveScene } from '../src/geometry/kernel';
const triangle = {
  dimension: 2,
  points: [
    { id: 'A', at: [0, 0] },
    { id: 'B', at: [6, 0] },
    { id: 'C', at: [0, 8] },
  ],
  segments: [
    { a: 'A', b: 'B' },
    { a: 'B', b: 'C' },
    { a: 'C', b: 'A' },
  ],
};
describe('geometry construction', () => {
  it('constructs midpoint and perpendicular foot from coordinates rather than guessed locations', () => {
    const scene = resolveScene({
      ...triangle,
      points: [
        ...triangle.points,
        { id: 'M', midpoint: ['B', 'C'] },
        { id: 'H', foot: { point: 'A', line: ['B', 'C'] } },
      ],
    });
    expect(scene.points.M).toEqual([3, 4, 0]);
    expect(scene.points.H[0]).toBeCloseTo(3.84);
    expect(scene.points.H[1]).toBeCloseTo(2.88);
  });
  it('resolves dependency order and line intersection', () => {
    const scene = resolveScene({
      ...triangle,
      points: [
        {
          id: 'P',
          intersection: [
            ['A', 'M'],
            ['B', 'C'],
          ],
        },
        ...triangle.points,
        { id: 'M', midpoint: ['B', 'C'] },
      ],
    });
    expect(scene.points.P).toEqual([3, 4, 0]);
  });
  it('rejects false constraints, missing references, degeneracy, and nonfinite values', () => {
    expect(() =>
      resolveScene({
        ...triangle,
        constraints: [{ kind: 'distance', a: 'A', b: 'B', value: 7 }],
      }),
    ).toThrow(/distance/i);
    expect(() => resolveScene({ ...triangle, segments: [{ a: 'A', b: 'Z' }] })).toThrow(/Z/);
    expect(() => resolveScene({ ...triangle, points: [{ id: 'A', at: [NaN, 0] }] })).toThrow();
    expect(() =>
      resolveScene({
        ...triangle,
        points: [...triangle.points, { id: 'A', at: [1, 1] }],
      }),
    ).toThrow(/duplicate/i);
    expect(() =>
      resolveScene({
        ...triangle,
        points: [...triangle.points, { id: 'M', midpoint: ['M', 'B'] }],
      }),
    ).toThrow(/resolve/i);
  });
  it('validates perpendicular and angle constraints independently', () => {
    expect(
      resolveScene({
        ...triangle,
        constraints: [
          {
            kind: 'perpendicular',
            lines: [
              ['A', 'B'],
              ['A', 'C'],
            ],
          },
          { kind: 'angle', points: ['B', 'A', 'C'], value: 90 },
        ],
      }).points.C,
    ).toEqual([0, 8, 0]);
    expect(() =>
      resolveScene({
        ...triangle,
        constraints: [{ kind: 'angle', points: ['A', 'B', 'C'], value: 90 }],
      }),
    ).toThrow(/angle/i);
  });
  it('constructs a cube with actual equal edge lengths and rejects flat solids', () => {
    const s = resolveScene({
      dimension: 3,
      solids: [{ id: 'cube', kind: 'cube', size: [4, 4, 4] }],
    });
    expect(Object.keys(s.points)).toHaveLength(8);
    expect(s.segments).toHaveLength(12);
    expect(s.points['cube.G']).toEqual([2, 2, 2]);
    expect(() =>
      resolveScene({
        dimension: 3,
        solids: [{ id: 'bad', kind: 'cuboid', size: [4, 0, 4] }],
      }),
    ).toThrow();
  });
  it('rejects off-plane points and collapsed polygons', () => {
    expect(() => resolveScene({ dimension: 2, points: [{ id: 'A', at: [0, 0, 2] }] })).toThrow(
      /plane/i,
    );
    expect(() => resolveScene({ ...triangle, polygons: [{ points: ['A', 'B', 'A'] }] })).toThrow();
  });
});

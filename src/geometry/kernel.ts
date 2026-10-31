// Adapted from sugarforever/smart (2026), MIT; see repository LICENSE.
import type { Scene, SceneSpec, Vec, Pair, SolidSpec } from './types';
export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: Vec, t: number): Vec => [a[0] * t, a[1] * t, a[2] * t];
export const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: Vec) => Math.hypot(...a);
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const EPS = 1e-6;
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
function vector(value: unknown): Vec {
  assert(
    Array.isArray(value) &&
      (value.length === 2 || value.length === 3) &&
      value.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e6),
    'Coordinates must be 2 or 3 finite numbers within ±1000000.',
  );
  return [value[0], value[1], value[2] ?? 0];
}
function positive(n: unknown): number {
  assert(
    typeof n === 'number' && Number.isFinite(n) && n > EPS && n <= 1e6,
    'Dimensions must be positive finite numbers.',
  );
  return n;
}
function text(v: unknown, max = 200): string {
  assert(typeof v === 'string' && v.length <= max, 'Invalid text.');
  return v;
}
function identifier(v: unknown): string {
  assert(
    typeof v === 'string' &&
      /^[\p{L}\p{N}_.'-]{1,40}$/u.test(v) &&
      !['__proto__', 'constructor', 'prototype'].includes(v),
    'Invalid point or solid ID.',
  );
  return v;
}
export function resolveScene(input: unknown): Scene {
  assert(input && typeof input === 'object', 'Scene must be an object.');
  const spec = structuredClone(input) as SceneSpec;
  assert(spec.dimension === 2 || spec.dimension === 3, 'Dimension must be 2 or 3.');
  for (const key of Object.keys(spec))
    assert(
      [
        'dimension',
        'title',
        'assumptions',
        'points',
        'segments',
        'circles',
        'angles',
        'polygons',
        'solids',
        'constraints',
      ].includes(key),
      `Unsupported scene field: ${key}`,
    );
  for (const key of [
    'points',
    'segments',
    'circles',
    'angles',
    'polygons',
    'solids',
    'constraints',
    'assumptions',
  ] as const)
    assert(
      spec[key] === undefined || (Array.isArray(spec[key]) && spec[key]!.length <= 300),
      `Invalid ${key} list (maximum 300).`,
    );
  const scene: Scene = {
    dimension: spec.dimension,
    title: spec.title === undefined ? 'Geometry study' : text(spec.title),
    assumptions: (spec.assumptions ?? []).map((a) => text(a, 500)),
    points: Object.create(null),
    labels: Object.create(null),
    segments: [],
    circles: [],
    angles: [],
    polygons: [],
    solids: [],
    spec,
  };
  const put = (id: string, p: Vec, label?: string) => {
    identifier(id);
    assert(!Object.hasOwn(scene.points, id), `Duplicate point ${id}.`);
    assert(spec.dimension === 3 || Math.abs(p[2]) < EPS, 'Point is outside the 2D plane.');
    scene.points[id] = vector(p);
    scene.labels[id] = label === undefined ? id : text(label, 50);
  };
  for (const solid of spec.solids ?? []) {
    assert(spec.dimension === 3, 'Solids require dimension 3.');
    identifier(solid.id);
    assert(!scene.solids.some((s) => s.id === solid.id), 'Duplicate solid ID.');
    assert(
      ['cube', 'cuboid', 'prism', 'pyramid', 'cylinder', 'cone', 'sphere'].includes(solid.kind),
      'Unsupported solid.',
    );
    const size = solid.size ?? [4, 4, 4];
    assert(Array.isArray(size) && size.length === 3, 'Solid size requires [width,height,depth].');
    size.forEach(positive);
    if (solid.kind === 'cube')
      assert(
        Math.abs(size[0] - size[1]) < EPS && Math.abs(size[1] - size[2]) < EPS,
        'Cube dimensions must be equal.',
      );
    if (solid.kind === 'sphere')
      assert(
        Math.abs(size[0] - size[1]) < EPS && Math.abs(size[1] - size[2]) < EPS,
        'Sphere dimensions must be equal.',
      );
    if (['cylinder', 'cone'].includes(solid.kind))
      assert(Math.abs(size[0] - size[2]) < EPS, 'Circular solids require equal width and depth.');
    const c = vector(solid.center ?? [0, 0, 0]);
    const [w, h, d] = size;
    const ids: string[] = [];
    const point = (suffix: string, p: Vec) => {
      const id = `${solid.id}.${suffix}`;
      put(id, add(p, c), suffix);
      ids.push(id);
      return id;
    };
    const edge = (a: string, b: string) => scene.segments.push({ a, b });
    if (['cube', 'cuboid'].includes(solid.kind)) {
      const coords: Vec[] = [
        [-w / 2, -h / 2, -d / 2],
        [w / 2, -h / 2, -d / 2],
        [w / 2, -h / 2, d / 2],
        [-w / 2, -h / 2, d / 2],
        [-w / 2, h / 2, -d / 2],
        [w / 2, h / 2, -d / 2],
        [w / 2, h / 2, d / 2],
        [-w / 2, h / 2, d / 2],
      ];
      coords.forEach((p, i) => point('ABCDEFGH'[i], p));
      for (const [a, b] of [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [4, 5],
        [5, 6],
        [6, 7],
        [7, 4],
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7],
      ])
        edge(ids[a], ids[b]);
      for (const indices of [
        [0, 1, 2, 3],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [1, 2, 6, 5],
        [2, 3, 7, 6],
        [3, 0, 4, 7],
      ])
        scene.polygons.push({ points: indices.map((i) => ids[i]) });
    } else if (['prism', 'pyramid'].includes(solid.kind)) {
      const n = solid.sides ?? 3;
      assert(Number.isInteger(n) && n >= 3 && n <= 12, 'Prisms/pyramids need 3–12 sides.');
      for (let i = 0; i < n; i++)
        point(String.fromCharCode(65 + i), [
          (w / 2) * Math.cos((i * 2 * Math.PI) / n),
          -h / 2,
          (d / 2) * Math.sin((i * 2 * Math.PI) / n),
        ]);
      if (solid.kind === 'pyramid') point('S', [0, h / 2, 0]);
      else
        for (let i = 0; i < n; i++)
          point(`${String.fromCharCode(65 + i)}'`, [
            (w / 2) * Math.cos((i * 2 * Math.PI) / n),
            h / 2,
            (d / 2) * Math.sin((i * 2 * Math.PI) / n),
          ]);
      scene.polygons.push({ points: ids.slice(0, n) });
      if (solid.kind === 'prism') scene.polygons.push({ points: ids.slice(n) });
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        edge(ids[i], ids[j]);
        edge(ids[i], solid.kind === 'pyramid' ? ids[n] : ids[n + i]);
        if (solid.kind === 'prism') edge(ids[n + i], ids[n + j]);
        scene.polygons.push({
          points:
            solid.kind === 'pyramid'
              ? [ids[i], ids[j], ids[n]]
              : [ids[i], ids[j], ids[n + j], ids[n + i]],
        });
      }
    } else {
      point('O', [0, 0, 0]);
      if (solid.kind !== 'sphere') {
        point('B', [0, -h / 2, 0]);
        point('T', [0, h / 2, 0]);
      }
    }
    scene.solids.push({ ...solid, size, center: c });
  }
  const pending = [...(spec.points ?? [])];
  const seen = new Set(Object.keys(scene.points));
  for (const p of pending) {
    identifier(p.id);
    assert(!seen.has(p.id), `Duplicate point ${p.id}.`);
    seen.add(p.id);
    assert(
      ['at', 'midpoint', 'foot', 'intersection', 'translate'].filter((k) => k in p).length === 1,
      `Point ${p.id} needs exactly one construction.`,
    );
  }
  const get = (id: string): Vec => {
    identifier(id);
    assert(Object.hasOwn(scene.points, id), `Unknown point ${id}.`);
    return scene.points[id];
  };
  const pair = (p: Pair): [Vec, Vec] => {
    assert(Array.isArray(p) && p.length === 2, 'Expected two point IDs.');
    const a = get(p[0]),
      b = get(p[1]);
    assert(norm(sub(a, b)) > EPS, 'Degenerate line.');
    return [a, b];
  };
  while (pending.length) {
    let progress = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i];
      let value: Vec;
      try {
        if ('at' in p) value = vector(p.at);
        else if ('midpoint' in p) {
          const [a, b] = pair(p.midpoint);
          value = mul(add(a, b), 0.5);
        } else if ('foot' in p) {
          const [a, b] = pair(p.foot.line),
            v = sub(b, a);
          value = add(a, mul(v, dot(sub(get(p.foot.point), a), v) / dot(v, v)));
        } else if ('translate' in p) {
          const [a, b] = pair(p.translate.vector);
          const scale = p.translate.scale ?? 1;
          assert(Number.isFinite(scale), 'Invalid translation scale.');
          value = add(get(p.translate.point), mul(sub(b, a), scale));
        } else {
          assert(spec.dimension === 2, 'Line intersection currently requires 2D.');
          const [a, b] = pair(p.intersection[0]),
            [c, d] = pair(p.intersection[1]);
          const u = sub(b, a),
            v = sub(d, c);
          const det = u[0] * v[1] - u[1] * v[0];
          assert(Math.abs(det) > EPS * norm(u) * norm(v), 'Lines have no unique intersection.');
          const t = ((c[0] - a[0]) * v[1] - (c[1] - a[1]) * v[0]) / det;
          value = add(a, mul(u, t));
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('Unknown point')) continue;
        throw e;
      }
      put(p.id, value, p.label);
      pending.splice(i, 1);
      progress = true;
    }
    assert(progress, `Cannot resolve point dependencies: ${pending.map((p) => p.id).join(', ')}.`);
  }
  const style = (obj: { color?: string; label?: string }) => {
    if (obj.color !== undefined)
      assert(/^#[0-9a-f]{6}$/i.test(obj.color), 'Color must be #rrggbb.');
    if (obj.label !== undefined) text(obj.label, 50);
  };
  for (const s of spec.segments ?? []) {
    pair([s.a, s.b]);
    style(s);
    if (s.line) assert(spec.dimension === 2, 'Infinite lines currently require 2D.');
    scene.segments.push(s);
  }
  for (const circle of spec.circles ?? []) {
    assert(spec.dimension === 2, 'Circles currently require 2D.');
    const c = get(circle.center);
    style(circle);
    assert(
      (circle.through !== undefined) !== (circle.radius !== undefined),
      'Circle needs either radius or through.',
    );
    const r = circle.through ? norm(sub(get(circle.through), c)) : positive(circle.radius);
    positive(r);
    scene.circles.push({ ...circle, radius: r });
  }
  for (const poly of spec.polygons ?? []) {
    assert(
      Array.isArray(poly.points) &&
        poly.points.length >= 3 &&
        poly.points.length <= 100 &&
        new Set(poly.points).size === poly.points.length,
      'Invalid polygon.',
    );
    poly.points.forEach(get);
    style(poly);
    const a = get(poly.points[0]);
    let area: Vec = [0, 0, 0];
    for (let i = 1; i < poly.points.length - 1; i++)
      area = add(area, cross(sub(get(poly.points[i]), a), sub(get(poly.points[i + 1]), a)));
    assert(norm(area) > EPS, 'Collapsed polygon.');
    const normal = mul(area, 1 / norm(area));
    assert(
      poly.points.every(
        (id) => Math.abs(dot(sub(get(id), a), normal)) < EPS * Math.max(1, norm(sub(get(id), a))),
      ),
      'Polygon vertices must be coplanar.',
    );
    scene.polygons.push(poly);
  }
  const angle = (ids: [string, string, string]) => {
    assert(Array.isArray(ids) && ids.length === 3, 'Angle needs three point IDs.');
    const [a, b] = pair([ids[1], ids[0]]),
      [, c] = pair([ids[1], ids[2]]);
    return (
      (Math.acos(
        Math.max(-1, Math.min(1, dot(sub(b, a), sub(c, a)) / (norm(sub(b, a)) * norm(sub(c, a))))),
      ) *
        180) /
      Math.PI
    );
  };
  for (const a of spec.angles ?? []) {
    angle(a.points);
    style(a);
    scene.angles.push(a);
  }
  for (const c of spec.constraints ?? []) {
    let valid = false;
    if (c.kind === 'distance') {
      positive(c.value);
      valid = Math.abs(norm(sub(get(c.a), get(c.b))) - c.value) <= EPS * Math.max(1, c.value);
    } else if (c.kind === 'angle') {
      assert(
        Number.isFinite(c.value) && c.value > 0 && c.value < 180,
        'Angle must be between 0 and 180.',
      );
      valid = Math.abs(angle(c.points) - c.value) < 1e-4;
    } else if (['perpendicular', 'parallel', 'equal'].includes(c.kind)) {
      const [a, b] = pair(c.lines[0]),
        [d, e] = pair(c.lines[1]),
        u = sub(b, a),
        v = sub(e, d);
      valid =
        c.kind === 'perpendicular'
          ? Math.abs(dot(u, v)) < EPS * norm(u) * norm(v)
          : c.kind === 'parallel'
            ? norm(cross(u, v)) < EPS * norm(u) * norm(v)
            : Math.abs(norm(u) - norm(v)) < EPS * Math.max(norm(u), norm(v));
    }
    assert(valid, `Unsatisfied ${c.kind} constraint.`);
  }
  assert(Object.keys(scene.points).length > 0, 'Scene must contain points or a solid.');
  return scene;
}

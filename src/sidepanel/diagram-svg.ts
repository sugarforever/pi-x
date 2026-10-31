import type { Scene, Vec } from '../geometry/types';
export interface DiagramView {
  zoom: number;
  yaw: number;
  pitch: number;
}
export const defaultDiagramView = (): DiagramView => ({ zoom: 1, yaw: -0.65, pitch: 0.4 });
const NS = 'http://www.w3.org/2000/svg';
export function drawScene(
  svg: SVGSVGElement,
  scene: Scene,
  view: DiagramView,
  labels: Record<string, [number, number]>,
  interactive = true,
) {
  const node = <K extends keyof SVGElementTagNameMap>(
    tag: K,
    attrs: Record<string, string | number> = {},
    text?: string,
  ) => {
    const el = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const project = (p: Vec): Vec => {
    if (scene.dimension === 2) return [p[0], p[1], 0];
    const x = Math.cos(view.yaw) * p[0] + Math.sin(view.yaw) * p[2];
    const z = -Math.sin(view.yaw) * p[0] + Math.cos(view.yaw) * p[2];
    return [
      x,
      Math.cos(view.pitch) * p[1] - Math.sin(view.pitch) * z,
      Math.sin(view.pitch) * p[1] + Math.cos(view.pitch) * z,
    ];
  };
  const bounds = Object.values(scene.points).map(project);
  for (const c of scene.circles) {
    const p = scene.points[c.center];
    bounds.push([p[0] - c.radius, p[1] - c.radius, 0], [p[0] + c.radius, p[1] + c.radius, 0]);
  }
  for (const solid of scene.solids) {
    const c = solid.center || [0, 0, 0],
      size = solid.size || [4, 4, 4];
    for (const x of [-1, 1])
      for (const y of [-1, 1])
        for (const z of [-1, 1])
          bounds.push(
            project([c[0] + (x * size[0]) / 2, c[1] + (y * size[1]) / 2, c[2] + (z * size[2]) / 2]),
          );
  }
  const xs = bounds.map((p) => p[0]),
    ys = bounds.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2,
    cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const baseScale = Math.min(
    680 / Math.max(1e-6, Math.max(...xs) - Math.min(...xs)),
    360 / Math.max(1e-6, Math.max(...ys) - Math.min(...ys)),
  );
  const scale = baseScale * view.zoom;
  const width = Math.max(180, (Math.max(...xs) - Math.min(...xs)) * baseScale + 100),
    height = Math.max(180, (Math.max(...ys) - Math.min(...ys)) * baseScale + 100);
  const at = (p: Vec): [number, number] => {
    const q = project(p);
    return [400 + (q[0] - cx) * scale, 250 - (q[1] - cy) * scale];
  };
  const point = (id: string) => at(scene.points[id]);
  svg.setAttribute('viewBox', `${400 - width / 2} ${250 - height / 2} ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', scene.title);
  svg.setAttribute('xmlns', NS);
  svg.replaceChildren(
    node('title', {}, scene.title),
    node('rect', { width: 800, height: 500, fill: '#fbfcfa' }),
  );
  const ink = '#285e57',
    accent = '#b86d38';
  const faces = [...scene.polygons].sort(
    (a, b) =>
      a.points.reduce((sum, id) => sum + project(scene.points[id])[2], 0) / a.points.length -
      b.points.reduce((sum, id) => sum + project(scene.points[id])[2], 0) / b.points.length,
  );
  for (const poly of faces)
    svg.append(
      node('polygon', {
        points: poly.points.map((id) => point(id).join(',')).join(' '),
        fill: poly.color || ink,
        'fill-opacity': scene.dimension === 3 ? 0.08 : 0.06,
        stroke: poly.color || ink,
        'stroke-width': 1.5,
      }),
    );
  for (const circle of scene.circles) {
    const p = point(circle.center);
    svg.append(
      node('circle', {
        cx: p[0],
        cy: p[1],
        r: circle.radius * scale,
        fill: 'none',
        stroke: circle.color || ink,
        'stroke-width': 2.2,
      }),
    );
  }
  const line = (a: [number, number], b: [number, number], color = ink, dashed = false) =>
    svg.append(
      node('line', {
        x1: a[0],
        y1: a[1],
        x2: b[0],
        y2: b[1],
        stroke: color,
        'stroke-width': 2.2,
        ...(dashed ? { 'stroke-dasharray': '7 5' } : {}),
      }),
    );
  const text = (value: string, p: [number, number], color = ink) =>
    node(
      'text',
      {
        x: p[0],
        y: p[1],
        fill: color,
        'font-size': 20,
        'font-family': 'Georgia, serif',
        'paint-order': 'stroke',
        stroke: '#fbfcfa',
        'stroke-width': 4,
        'stroke-linejoin': 'round',
      },
      value,
    );
  for (const segment of scene.segments) {
    let a = point(segment.a),
      b = point(segment.b);
    if (segment.line) {
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        r = 1200 / Math.hypot(dx, dy);
      a = [a[0] - dx * r, a[1] - dy * r];
      b = [b[0] + dx * r, b[1] + dy * r];
    }
    line(a, b, segment.color || (segment.dashed ? accent : ink), segment.dashed);
    if (segment.label)
      svg.append(text(segment.label, [(a[0] + b[0]) / 2 + 8, (a[1] + b[1]) / 2 - 9]));
  }
  // Curved solids are sampled into deterministic, rotatable wireframes.
  for (const solid of scene.solids.filter((s) => ['sphere', 'cone', 'cylinder'].includes(s.kind))) {
    const c = solid.center || [0, 0, 0],
      [w, h, d] = solid.size || [4, 4, 4];
    const world = (x: number, y: number, z: number): Vec => [c[0] + x, c[1] + y, c[2] + z];
    const curve = (fn: (t: number) => Vec) => {
      const points = Array.from({ length: 65 }, (_, i) => at(fn((i * Math.PI * 2) / 64)));
      svg.append(
        node('polyline', {
          points: points.map((p) => p.join(',')).join(' '),
          fill: 'none',
          stroke: ink,
          'stroke-width': 1.5,
        }),
      );
    };
    if (solid.kind === 'sphere') {
      for (const latitude of [-Math.PI / 3, 0, Math.PI / 3])
        curve((t) =>
          world(
            (w / 2) * Math.cos(latitude) * Math.cos(t),
            (h / 2) * Math.sin(latitude),
            (d / 2) * Math.cos(latitude) * Math.sin(t),
          ),
        );
      for (const longitude of [0, Math.PI / 3, (Math.PI * 2) / 3])
        curve((t) =>
          world(
            (w / 2) * Math.cos(t) * Math.cos(longitude),
            (h / 2) * Math.sin(t),
            (d / 2) * Math.cos(t) * Math.sin(longitude),
          ),
        );
    } else {
      curve((t) => world((w / 2) * Math.cos(t), -h / 2, (d / 2) * Math.sin(t)));
      if (solid.kind === 'cylinder')
        curve((t) => world((w / 2) * Math.cos(t), h / 2, (d / 2) * Math.sin(t)));
      for (let i = 0; i < 8; i++) {
        const t = (i * Math.PI) / 4;
        line(
          at(world((w / 2) * Math.cos(t), -h / 2, (d / 2) * Math.sin(t))),
          at(
            solid.kind === 'cone'
              ? world(0, h / 2, 0)
              : world((w / 2) * Math.cos(t), h / 2, (d / 2) * Math.sin(t)),
          ),
        );
      }
    }
  }
  for (const angle of scene.angles) {
    const [a, b, c] = angle.points.map(point),
      u = [a[0] - b[0], a[1] - b[1]],
      v = [c[0] - b[0], c[1] - b[1]];
    const start = Math.atan2(u[1], u[0]),
      end = Math.atan2(v[1], v[0]);
    const delta = Math.atan2(Math.sin(end - start), Math.cos(end - start));
    const radius = Math.min(32, Math.hypot(...u) * 0.25, Math.hypot(...v) * 0.25);
    const p = [b[0] + Math.cos(start) * radius, b[1] + Math.sin(start) * radius],
      q = [b[0] + Math.cos(end) * radius, b[1] + Math.sin(end) * radius];
    svg.append(
      node('path', {
        d: `M ${p.join(' ')} A ${radius} ${radius} 0 0 ${delta > 0 ? 1 : 0} ${q.join(' ')}`,
        fill: 'none',
        stroke: angle.color || accent,
        'stroke-width': 1.8,
      }),
    );
    if (angle.label)
      svg.append(
        text(
          angle.label,
          [
            b[0] + Math.cos(start + delta / 2) * (radius + 20),
            b[1] + Math.sin(start + delta / 2) * (radius + 20),
          ],
          angle.color || accent,
        ),
      );
  }
  for (const [id, p] of Object.entries(scene.points)) {
    const q = at(p),
      offset = labels[id] || [12, -12];
    svg.append(node('circle', { cx: q[0], cy: q[1], r: 3.5, fill: ink }));
    if (scene.labels[id]) {
      const x = q[0] + offset[0],
        y = q[1] + offset[1];
      const label = node('g', {
        'data-point': id,
        ...(interactive
          ? { role: 'button', tabindex: 0, 'aria-label': `Move label ${scene.labels[id]}` }
          : {}),
      });
      const hit = node('rect', {
        x: x - 7,
        y: y - 21,
        width: Math.max(28, scene.labels[id].length * 12 + 14),
        height: 28,
        rx: 5,
        fill: 'transparent',
        'pointer-events': 'all',
        'data-label-hit': '',
      });
      const caption = text(scene.labels[id], [x, y]);
      caption.setAttribute('pointer-events', 'none');
      if (interactive)
        label.append(
          node(
            'title',
            {},
            `Drag ${scene.labels[id]} to move its label, or focus it and use arrow keys.`,
          ),
          hit,
        );
      label.append(caption);
      svg.append(label);
    }
  }
}

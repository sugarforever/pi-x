// Adapted from sugarforever/smart (2026), MIT; see repository LICENSE.
export type Vec = [number, number, number];
export type Pair = [string, string];
export type PointSpec = { id: string; label?: string } & (
  | { at: number[] }
  | { midpoint: Pair }
  | { foot: { point: string; line: Pair } }
  | { intersection: [Pair, Pair] }
  | { translate: { point: string; vector: Pair; scale?: number } }
);
export type Segment = {
  a: string;
  b: string;
  dashed?: boolean;
  color?: string;
  label?: string;
  line?: boolean;
};
export type Circle = {
  center: string;
  radius?: number;
  through?: string;
  color?: string;
};
export type Angle = {
  points: [string, string, string];
  label?: string;
  color?: string;
};
export type Polygon = { points: string[]; color?: string };
export type SolidSpec = {
  id: string;
  kind: 'cube' | 'cuboid' | 'prism' | 'pyramid' | 'cylinder' | 'cone' | 'sphere';
  size?: number[];
  center?: number[];
  sides?: number;
};
export type Constraint =
  | { kind: 'distance'; a: string; b: string; value: number }
  | { kind: 'perpendicular' | 'parallel'; lines: [Pair, Pair] }
  | { kind: 'equal'; lines: [Pair, Pair] }
  | { kind: 'angle'; points: [string, string, string]; value: number };
export interface SceneSpec {
  dimension: 2 | 3;
  title?: string;
  assumptions?: string[];
  points?: PointSpec[];
  segments?: Segment[];
  circles?: Circle[];
  angles?: Angle[];
  polygons?: Polygon[];
  solids?: SolidSpec[];
  constraints?: Constraint[];
}
export interface Scene {
  dimension: 2 | 3;
  title: string;
  assumptions: string[];
  points: Record<string, Vec>;
  labels: Record<string, string>;
  segments: Segment[];
  circles: (Circle & { radius: number })[];
  angles: Angle[];
  polygons: Polygon[];
  solids: SolidSpec[];
  spec: SceneSpec;
}

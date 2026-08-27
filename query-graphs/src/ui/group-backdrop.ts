export interface GroupPoint {
  group: string;
  x: number;
  y: number;
}

export interface GroupBackdrop {
  groupId: string;
  // Position of the backdrop's bounding box, in the same coordinate space as node positions
  x: number;
  y: number;
  width: number;
  height: number;
  // Path data, in coordinates local to (x, y) — i.e. already shifted so the bounding box starts at (0, 0)
  pathData: string;
  // The polygon vertices `pathData` was built from (padded hull corners, or bounding-box
  // corners in the fallback case), in the same local coordinates. Exposed so the shape's
  // defining points can be drawn explicitly, e.g. to debug the hull/padding computation.
  points: {x: number; y: number}[];
  color: string;
}

function normalize([x, y]: [number, number]): [number, number] {
  const len = Math.sqrt(x * x + y * y);
  return len > 0 ? [x / len, y / len] : [0, 0];
}

function cross(o: [number, number], a: [number, number], b: [number, number]): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function convexHull(points: [number, number][]): [number, number][] {
  if (points.length < 3) return [];

  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const lower: [number, number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: [number, number][] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

interface ExpandedPolygon {
  x: number;
  y: number;
  width: number;
  height: number;
  // Path data, shifted so the bounding box's top-left corner is at (0, 0)
  pathData: string;
  // The polygon vertices, in the same local coordinates as `pathData`
  points: {x: number; y: number}[];
}

function expandPolygonWithRounding(
  hull: [number, number][],
  padding: number,
  cornerRadius: number = padding
): ExpandedPolygon | null {
  if (hull.length < 3) return null;

  // `convexHull` produces vertices in clockwise order in screen coordinates (y grows down).
  // For a clockwise polygon, rotating an edge's direction vector (dx, dy) by (dy, -dx) points
  // outward. (Rotating by (-dy, dx) — as an earlier version of this code did — points inward,
  // shrinking the hull below the actual node extents instead of padding outward from them.)
  //
  // Step 1: expand each vertex outward along the miter direction (average of the two
  // adjacent edge normals). A plain per-vertex offset of exactly `padding` along that
  // direction undershoots at corners — the edges themselves would end up closer than
  // `padding` to the original hull — so the offset is scaled up by 1/cos(half the angle
  // between the normals), the standard miter-join length. Sharp/acute corners are clamped
  // to avoid the miter shooting off to a very long spike.
  const maxMiterFactor = 4;
  const expanded = hull.map((vertex, i) => {
    const prev = hull[(i - 1 + hull.length) % hull.length];
    const next = hull[(i + 1) % hull.length];

    const edge1 = [vertex[0] - prev[0], vertex[1] - prev[1]] as [number, number];
    const edge2 = [next[0] - vertex[0], next[1] - vertex[1]] as [number, number];

    const normal1 = normalize([edge1[1], -edge1[0]]);
    const normal2 = normalize([edge2[1], -edge2[0]]);
    const avgNormal = normalize([
      normal1[0] + normal2[0],
      normal1[1] + normal2[1],
    ]);

    const cosHalfAngle = avgNormal[0] * normal1[0] + avgNormal[1] * normal1[1];
    const miterFactor = cosHalfAngle > 0 ? Math.min(1 / cosHalfAngle, maxMiterFactor) : maxMiterFactor;

    return {
      x: vertex[0] + avgNormal[0] * padding * miterFactor,
      y: vertex[1] + avgNormal[1] * padding * miterFactor,
    };
  });

  // Step 2: Compute the bounding box, so we can express the path in local coordinates.
  // A backdrop is rendered as a plain react-flow node; nodes are auto-sized from their
  // rendered content, and an absolutely-positioned <svg width="100%"> inside a node with
  // no intrinsic size collapses to 0x0 (and gets clipped) — so the node needs an explicit
  // width/height, and the path coordinates must be local to that box.
  const minX = Math.min(...expanded.map((p) => p.x));
  const minY = Math.min(...expanded.map((p) => p.y));
  const maxX = Math.max(...expanded.map((p) => p.x));
  const maxY = Math.max(...expanded.map((p) => p.y));
  const local = expanded.map((p) => ({x: p.x - minX, y: p.y - minY}));

  // Step 3: Build SVG path with rounded corners using cubic Bézier curves
  let pathData = `M ${local[0].x} ${local[0].y}`;

  for (let i = 1; i <= local.length; i++) {
    const curr = local[i % local.length];
    const prev = local[(i - 1) % local.length];
    const next = local[(i + 1) % local.length];

    const [dx, dy] = normalize([next.x - prev.x, next.y - prev.y]);
    const tx = dx * cornerRadius;
    const ty = dy * cornerRadius;

    pathData += ` C ${prev.x + tx} ${prev.y + ty}, ${curr.x - tx} ${curr.y - ty}, ${curr.x} ${curr.y}`;
  }

  pathData += " Z";
  return {x: minX, y: minY, width: maxX - minX, height: maxY - minY, pathData, points: local};
}

// Fallback for groups whose convex hull is degenerate (fewer than 3 points, or all
// points collinear — e.g. a straight, unbranched chain of nodes, which lays out as a
// single vertical line with no lateral spread). Draws a padded, rounded bounding box
// around the raw points instead, which trivially covers them regardless of their layout.
function boundingBoxBackdrop(rawPoints: [number, number][], padding: number, cornerRadius: number): ExpandedPolygon {
  const minX = Math.min(...rawPoints.map((p) => p[0])) - padding;
  const minY = Math.min(...rawPoints.map((p) => p[1])) - padding;
  const maxX = Math.max(...rawPoints.map((p) => p[0])) + padding;
  const maxY = Math.max(...rawPoints.map((p) => p[1])) + padding;
  const width = maxX - minX;
  const height = maxY - minY;
  const r = Math.min(cornerRadius, width / 2, height / 2);

  const pathData =
    `M ${r} 0` +
    ` H ${width - r}` +
    ` A ${r} ${r} 0 0 1 ${width} ${r}` +
    ` V ${height - r}` +
    ` A ${r} ${r} 0 0 1 ${width - r} ${height}` +
    ` H ${r}` +
    ` A ${r} ${r} 0 0 1 0 ${height - r}` +
    ` V ${r}` +
    ` A ${r} ${r} 0 0 1 ${r} 0` +
    ` Z`;

  const points = [
    {x: 0, y: 0},
    {x: width, y: 0},
    {x: width, y: height},
    {x: 0, y: height},
  ];
  return {x: minX, y: minY, width, height, pathData, points};
}

// Color palette for group backdrops
const groupColors = [
  "rgba(100, 150, 200, 0.15)", // blue
  "rgba(150, 100, 200, 0.15)", // purple
  "rgba(100, 200, 150, 0.15)", // teal
  "rgba(200, 150, 100, 0.15)", // orange
  "rgba(200, 100, 150, 0.15)", // pink
  "rgba(150, 200, 100, 0.15)", // lime
];

const groupStrokeColors = [
  "rgba(100, 150, 200, 0.4)", // blue
  "rgba(150, 100, 200, 0.4)", // purple
  "rgba(100, 200, 150, 0.4)", // teal
  "rgba(200, 150, 100, 0.4)", // orange
  "rgba(200, 100, 150, 0.4)", // pink
  "rgba(150, 200, 100, 0.4)", // lime
];

function getColorForGroup(groupId: string, index: number): string {
  return groupColors[index % groupColors.length];
}

function getStrokeColorForGroup(groupId: string, index: number): string {
  return groupStrokeColors[index % groupStrokeColors.length];
}

export function computeGroupBackdrops(
  // One point per node corner (not one point per node) — see the call site, which
  // expands each grouped node into its 4 rendered corners. Using only node anchor
  // points would let a wide/tall node's edges stick out past the backdrop.
  points: GroupPoint[],
  padding: number = 20,
  cornerRadius: number = 15
): GroupBackdrop[] {
  // Group points by their semantic group
  const groups = new Map<string, [number, number][]>();
  for (const point of points) {
    if (!groups.has(point.group)) groups.set(point.group, []);
    groups.get(point.group)!.push([point.x, point.y]);
  }

  // For each group, compute convex hull (falling back to a bounding box when the hull is degenerate)
  const backdrops: GroupBackdrop[] = [];
  let groupIndex = 0;
  for (const [groupId, positions] of groups) {
    const hull = positions.length >= 3 ? convexHull(positions) : [];
    const expanded =
      hull.length >= 3
        ? expandPolygonWithRounding(hull, padding, cornerRadius)
        : boundingBoxBackdrop(positions, padding, cornerRadius);
    if (!expanded) continue;

    const color = getColorForGroup(groupId, groupIndex);
    const strokeColor = getStrokeColorForGroup(groupId, groupIndex);

    backdrops.push({
      groupId,
      x: expanded.x,
      y: expanded.y,
      width: expanded.width,
      height: expanded.height,
      pathData: expanded.pathData,
      points: expanded.points,
      color: `${color}|${strokeColor}`, // Store both in pipe-separated format for rendering
    });

    groupIndex++;
  }

  return backdrops;
}

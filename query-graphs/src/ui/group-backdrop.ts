import * as ClipperLib from "clipper-lib";

// One padded rectangle per grouped node.
export interface GroupNodeBox {
    group: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

// One connector per parent-child edge that stays within a single group — i.e. it does not
// include the edge from a group's un-grouped createtemptable boundary node down to its first
// grouped descendant. Traced as a quadrilateral from the source node's bottom edge to the
// target node's top edge, so its width tapers to match each endpoint's actual node width
// rather than being a fixed-width tube.
export interface GroupEdge {
    group: string;
    sourceLeft: number;
    sourceRight: number;
    sourceBottom: number;
    targetLeft: number;
    targetRight: number;
    targetTop: number;
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
    // The polygon vertices `pathData` was built from, in the same local coordinates. Exposed so
    // the shape's defining points can be drawn explicitly, e.g. to debug the outline computation.
    points: {x: number; y: number}[];
    color: string;
}

// Clipper requires integer coordinates for numerical robustness, so pixel coordinates are
// scaled up before being handed to it (and scaled back down on the way out). A factor of 100
// keeps 0.01px precision, which is far below what's visually distinguishable.
const CLIPPER_SCALE = 100;
// How closely Clipper's polyline approximation of a rounded join/cap is allowed to deviate
// from the true circular arc, in scaled units. Small enough to look smooth, large enough that
// a corner doesn't turn into hundreds of vertices.
const ARC_TOLERANCE = 0.25 * CLIPPER_SCALE;

function toClipperPoint(x: number, y: number): ClipperLib.IntPoint {
    return {X: Math.round(x * CLIPPER_SCALE), Y: Math.round(y * CLIPPER_SCALE)};
}

function fromClipperPath(path: ClipperLib.Path): {x: number; y: number}[] {
    return path.map((p) => ({x: p.X / CLIPPER_SCALE, y: p.Y / CLIPPER_SCALE}));
}

// Unions the padded node rectangles and edge capsules of a single group into one (or, only if
// the group is disconnected, several) rounded outline(s) — replacing the previous convex-hull +
// hand-rolled miter-offset + corner-rounding pipeline, which could swallow unrelated nodes
// sitting in the "notch" of a non-convex point set and had repeated corner-rounding bugs.
function computeGroupOutline(boxes: GroupNodeBox[], edges: GroupEdge[], padding: number): {x: number; y: number}[][] {
    const offset = new ClipperLib.ClipperOffset(2, ARC_TOLERANCE);
    for (const box of boxes) {
        const rect: ClipperLib.Path = [
            toClipperPoint(box.x, box.y),
            toClipperPoint(box.x + box.width, box.y),
            toClipperPoint(box.x + box.width, box.y + box.height),
            toClipperPoint(box.x, box.y + box.height),
        ];
        offset.AddPath(rect, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    }
    for (const edge of edges) {
        // A quadrilateral connecting the source node's bottom-left/bottom-right corners to the
        // target node's top-left/top-right corners — connecting left-to-left and right-to-right
        // keeps it simple (non-self-intersecting) even when the two nodes are horizontally offset.
        const quad: ClipperLib.Path = [
            toClipperPoint(edge.sourceLeft, edge.sourceBottom),
            toClipperPoint(edge.sourceRight, edge.sourceBottom),
            toClipperPoint(edge.targetRight, edge.targetTop),
            toClipperPoint(edge.targetLeft, edge.targetTop),
        ];
        offset.AddPath(quad, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    }

    const solution: ClipperLib.Paths = [];
    offset.Execute(solution, padding * CLIPPER_SCALE);
    return solution.map(fromClipperPath);
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

export function computeGroupBackdrops(nodeBoxes: GroupNodeBox[], groupEdges: GroupEdge[], padding = 20): GroupBackdrop[] {
    const boxesByGroup = new Map<string, GroupNodeBox[]>();
    for (const box of nodeBoxes) {
        if (!boxesByGroup.has(box.group)) boxesByGroup.set(box.group, []);
        boxesByGroup.get(box.group)!.push(box);
    }
    const edgesByGroup = new Map<string, GroupEdge[]>();
    for (const edge of groupEdges) {
        if (!edgesByGroup.has(edge.group)) edgesByGroup.set(edge.group, []);
        edgesByGroup.get(edge.group)!.push(edge);
    }

    const backdrops: GroupBackdrop[] = [];
    let groupIndex = 0;
    for (const [groupId, boxes] of boxesByGroup) {
        const loops = computeGroupOutline(boxes, edgesByGroup.get(groupId) ?? [], padding).filter((loop) => loop.length > 0);
        if (loops.length === 0) continue;

        const allPoints = loops.flat();
        const minX = Math.min(...allPoints.map((p) => p.x));
        const minY = Math.min(...allPoints.map((p) => p.y));
        const maxX = Math.max(...allPoints.map((p) => p.x));
        const maxY = Math.max(...allPoints.map((p) => p.y));
        const localLoops = loops.map((loop) => loop.map((p) => ({x: p.x - minX, y: p.y - minY})));

        const pathData = localLoops
            .map(([first, ...rest]) => `M ${first.x} ${first.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(" ") + " Z")
            .join(" ");

        const color = getColorForGroup(groupId, groupIndex);
        const strokeColor = getStrokeColorForGroup(groupId, groupIndex);

        backdrops.push({
            groupId,
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
            pathData,
            points: localLoops.flat(),
            color: `${color}|${strokeColor}`, // Store both in pipe-separated format for rendering
        });

        groupIndex++;
    }

    return backdrops;
}

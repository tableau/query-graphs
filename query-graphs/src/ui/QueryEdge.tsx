import type {Edge, EdgeProps} from "@xyflow/react";
import {BaseEdge, EdgeLabelRenderer, getBezierPath} from "@xyflow/react";
import cc from "classcat";
import "./QueryEdge.css";

// Must be a `type` instead of the usual `interface`.
// xyflow's `Edge<EdgeData>` requires EdgeData to satisfy `Record<string, unknown>` and
// TypeScript only infers that implicit index signature for type aliases, not interfaces.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type QueryEdgeData = {
    // The colors of this edge. More than one is drawn as a contiguous
    // color-band gradient (source -> target); a single color is a solid stroke.
    colors?: string[];
    // Explanation shown as a hover tooltip on the edge label (e.g. why it is highlighted).
    edgeReason?: string;
    // Whether the row-count label is highlighted (e.g. a cardinality misestimate). Carried through
    // `data` rather than the edge's `className` because the label is rendered in the edge-label layer
    // (portaled out of the edge's `<g>` by `EdgeLabelRenderer`), so a descendant CSS selector on the
    // edge wrapper can no longer reach it.
    labelHighlighted?: boolean;
};

export type QueryGraphEdge = Edge<QueryEdgeData, "queryedge">;

// A tree edge that can carry multiple colors (drawn as a source->target gradient of contiguous
// color bands; a single color is a solid stroke) and, when the edge carries a "why highlighted"
// reason, shows it as a native tooltip on hover.
//
// The row-count label is rendered through `EdgeLabelRenderer` instead of the SVG `EdgeText`: that
// layer is portaled ABOVE the nodes, so an expanded node never paints over the label (the edges SVG
// otherwise sits below the nodes layer). The edge *path* still draws below the nodes via `BaseEdge`.
export function QueryEdge(props: EdgeProps<QueryGraphEdge>) {
    const {id, sourceX, sourceY, targetX, targetY, markerEnd, label, style} = props;
    const [edgePath, labelX, labelY] = getBezierPath(props);

    const colors = props.data?.colors ?? [];
    const reason = props.data?.edgeReason;
    const highlighted = props.data?.labelHighlighted;
    const multi = colors.length > 1;

    // Unique gradient id for this edge (only used in the multi-color case).
    const gradientId = `qg-edge-grad-${id}`.replace(/[^a-zA-Z0-9_-]/g, "_");

    const pathStyle = multi ? {...style, stroke: `url(#${gradientId})`} : {...style, stroke: colors[0] ?? style?.stroke};

    return (
        <>
            {multi && (
                <defs>
                    {/* Contiguous color bands along the edge (source -> target). */}
                    <linearGradient
                        id={gradientId}
                        gradientUnits="userSpaceOnUse"
                        x1={sourceX}
                        y1={sourceY}
                        x2={targetX}
                        y2={targetY}
                    >
                        {colors.flatMap((c, i) => [
                            <stop key={`${i}a`} offset={`${(i / colors.length) * 100}%`} stopColor={c} />,
                            <stop key={`${i}b`} offset={`${((i + 1) / colors.length) * 100}%`} stopColor={c} />,
                        ])}
                    </linearGradient>
                </defs>
            )}
            <BaseEdge path={edgePath} markerEnd={markerEnd} style={pathStyle} />
            {label !== undefined && label !== null ? (
                <EdgeLabelRenderer>
                    <div
                        className={cc([
                            "qg-edge-label",
                            {
                                "qg-edge-label-highlighted": !!highlighted,
                                "qg-edge-label-has-reason": !!reason,
                            },
                        ])}
                        // Positioned at the edge midpoint in flow coordinates; the edge-label layer
                        // carries the viewport transform, so this tracks pan/zoom automatically.
                        style={{transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`}}
                        title={reason}
                    >
                        {label}
                    </div>
                </EdgeLabelRenderer>
            ) : null}
        </>
    );
}

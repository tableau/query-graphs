import {BaseEdge, EdgeProps, EdgeText, getBezierPath} from "reactflow";

// A custom edge that draws the default bezier path and reuses react-flow's own EdgeText for the
// row-count label (so existing label styling still applies), but wraps it so the label carries an
// SVG <title>. Hovering the label then shows a native tooltip explaining why the edge is
// highlighted (e.g. a cardinality misestimate).
export function QueryEdge({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    label,
    style,
    markerEnd,
    data,
}: EdgeProps<{edgeReason?: string}>) {
    const [path, labelX, labelY] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
    });

    const reason = data?.edgeReason;

    return (
        <>
            <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
            {label !== undefined && label !== null ? (
                // The <title> is a child of the same <g> react-flow's EdgeText renders, so it acts as
                // the tooltip for the whole label (background + text).
                <g className={reason ? "qg-edge-label-has-reason" : undefined}>
                    {reason ? <title>{reason}</title> : null}
                    <EdgeText x={labelX} y={labelY} label={label} />
                </g>
            ) : null}
        </>
    );
}

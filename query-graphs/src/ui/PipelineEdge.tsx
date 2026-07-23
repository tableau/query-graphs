import {BaseEdge, EdgeProps, getBezierPath} from "reactflow";

// Data attached to a colored edge.
export interface PipelineEdgeData {
    // The colors of this edge. More than one is drawn as a contiguous
    // color-band gradient (source -> target); a single color is a solid stroke.
    colors?: string[];
    // The edge thickness (encodes rows flowing), in pixels.
    strokeWidth?: number;
}

// A tree edge that can carry multiple colors.
//
// An edge can belong to several pipelines at once (e.g. the edge above a
// UNION ALL target, executed once per input). When several colors are given the
// stroke is painted with a gradient of contiguous color bands (one per color,
// running source->target); a single color is drawn as a solid stroke.
export function PipelineEdge(props: EdgeProps<PipelineEdgeData>) {
    const {id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, markerEnd, label, labelStyle, style} = props;
    const [edgePath, labelX, labelY] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
    });

    const colors = props.data?.colors ?? [];
    const multi = colors.length > 1;

    // Unique gradient id for this edge (only used in the multi-color case).
    const gradientId = `qg-edge-grad-${id}`.replace(/[^a-zA-Z0-9_-]/g, "_");

    if (multi) {
        return (
            <>
                <defs>
                    {/* Contiguous color bands along the edge (source -> target). */}
                    <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}>
                        {colors.flatMap((c, i) => [
                            <stop key={`${i}a`} offset={`${(i / colors.length) * 100}%`} stopColor={c} />,
                            <stop key={`${i}b`} offset={`${((i + 1) / colors.length) * 100}%`} stopColor={c} />,
                        ])}
                    </linearGradient>
                </defs>
                <BaseEdge
                    path={edgePath}
                    labelX={labelX}
                    labelY={labelY}
                    label={label}
                    labelStyle={labelStyle}
                    markerEnd={markerEnd}
                    style={{...style, stroke: `url(#${gradientId})`}}
                />
            </>
        );
    }

    return (
        <BaseEdge
            path={edgePath}
            labelX={labelX}
            labelY={labelY}
            label={label}
            labelStyle={labelStyle}
            markerEnd={markerEnd}
            style={{...style, stroke: colors[0] ?? style?.stroke}}
        />
    );
}

import {BaseEdge, EdgeProps, getBezierPath} from "reactflow";

// Data attached to a pipeline-colored edge.
export interface PipelineEdgeData {
    // The dominant pipeline color of this edge (fallback / single-pipeline case).
    pipelineColor?: string;
    // The colors of *all* pipelines flowing across this edge, ordered
    // left-to-right. When more than one, the edge is stroked with a gradient of
    // contiguous color bands and the start-bar is split into one segment per
    // pipeline.
    pipelineColors?: string[];
    // The edge thickness (encodes rows flowing), in pixels.
    strokeWidth?: number;
}

// A tree edge that carries execution-pipeline color(s).
//
// An edge can belong to several pipelines at once (e.g. the edge above a
// UNION ALL target, executed once per input). All of them are shown: the stroke
// is painted with a gradient of contiguous color bands (one band per pipeline,
// running source->target), and a matching segmented "bar" is drawn where the
// edge leaves the producing operator.
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

    const colors = props.data?.pipelineColors?.length
        ? props.data.pipelineColors
        : props.data?.pipelineColor
          ? [props.data.pipelineColor]
          : [];
    const multi = colors.length > 1;

    // Segmented start-bar geometry (drawn where the edge leaves the producing
    // operator, i.e. at the target/child end).
    const barWidth = Math.max(16, colors.length * 6);
    const segWidth = colors.length ? barWidth / colors.length : 0;
    const barLeft = targetX - barWidth / 2;
    const barHeight = 5;

    // Unique gradient id for this edge (only used in the multi-pipeline case).
    const gradientId = `qg-edge-grad-${id}`.replace(/[^a-zA-Z0-9_-]/g, "_");

    return (
        <>
            {multi ? (
                <>
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
            ) : (
                <BaseEdge
                    path={edgePath}
                    labelX={labelX}
                    labelY={labelY}
                    label={label}
                    labelStyle={labelStyle}
                    markerEnd={markerEnd}
                    style={{...style, stroke: colors[0] ?? style?.stroke}}
                />
            )}
            {colors.map((c, i) => (
                <rect
                    key={i}
                    className="qg-pipeline-edge-bar"
                    x={barLeft + i * segWidth}
                    y={targetY - barHeight / 2}
                    width={segWidth}
                    height={barHeight}
                    rx={i === 0 || i === colors.length - 1 ? 1.5 : 0}
                    fill={c}
                />
            ))}
        </>
    );
}

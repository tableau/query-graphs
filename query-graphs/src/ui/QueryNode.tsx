import {memo, ReactElement, MouseEvent, useCallback, useRef, useEffect, RefObject, CSSProperties} from "react";
import {Handle, NodeProps, Position} from "reactflow";
import cc from "classcat";
import {TreeNode} from "../tree-description";
import {NodeIcon} from "./NodeIcon";
import "./QueryNode.css";
import {useGraphRenderingStore} from "./store";
import {assert} from "../loader-utils";

type NodeData = TreeNode & {resizeObserver: ResizeObserver};

function useResizeObservedRef<T extends Element>(resizeObserver: ResizeObserver): RefObject<T> {
    const ref = useRef<T>(null);
    useEffect(() => {
        assert(ref.current !== null);
        const currNode = ref.current;
        resizeObserver.observe(currNode);
        return () => resizeObserver.unobserve(currNode);
    }, [resizeObserver]);
    return ref;
}

function QueryNode({data, id}: NodeProps<NodeData>) {
    const bodyRef = useResizeObservedRef<HTMLDivElement>(data.resizeObserver);
    const headRef = useResizeObservedRef<HTMLDivElement>(data.resizeObserver);

    const expanded = useGraphRenderingStore((s) => s.expandedNodes[id]);
    const toggleNode = useGraphRenderingStore((s) => s.toggleExpandedNode);
    const subtreeExpanded = useGraphRenderingStore((s) => s.expandedSubtrees[id]);
    const toggleSubtree = useGraphRenderingStore((s) => s.toggleExpandedSubtree);

    const hasProperties = data.properties?.size;
    const hasSubtree = data.collapsedChildren && data.collapsedChildren.length > 0;

    const onClick = useCallback(
        (e: MouseEvent) => {
            if (e.shiftKey) {
                if (hasSubtree) toggleSubtree(id);
            } else {
                if (hasProperties) toggleNode(id);
            }
            e.stopPropagation();
        },
        [toggleNode, toggleSubtree, hasProperties, hasSubtree, id],
    );
    const onSubtreeHandleClick = useCallback(
        (e: MouseEvent) => {
            if (hasSubtree) toggleSubtree(id);
            e.stopPropagation();
        },
        [toggleSubtree, hasSubtree, id],
    );

    const children = [] as ReactElement[];
    for (const [key, value] of (data.properties || []).entries()) {
        // A few properties are called out among the other scan metrics with a highlight:
        // `index-rec` gets an amber highlight; `index-used` is highlighted informational blue, but
        // only when an index was actually used (value != "no").
        const emphasized = key === "index-rec";
        const indexUsed = key === "index-used" && value !== "no";
        // On a costly scan, the processed-rows / rows-matching rows are flagged in light red.
        const costlyScan = data.costlyScan && (key === "processed-rows" || key === "rows-matching");
        const rowClassName = cc([
            "qg-prop",
            {"qg-prop-emphasized": emphasized, "qg-prop-index-used": indexUsed, "qg-prop-costly-scan": costlyScan},
        ]);
        // Tint the cpu-cycles row with the same runtime-heatmap color used on the node label, so an
        // expensive node reads the same whether it is collapsed (label only) or expanded. Likewise,
        // tint a costly scan's processed-rows / rows-matching rows with the same proportional red as
        // the node box, so the opened node matches its collapsed shade.
        let rowStyle: CSSProperties | undefined;
        if (key === "cpu-cycles" && data.nodeColor) {
            rowStyle = {background: data.nodeColor};
        } else if (costlyScan && data.costlyScanColor) {
            rowStyle = {background: data.costlyScanColor};
        }
        children.push(
            <div key={key} className={rowClassName} style={rowStyle}>
                <span className="qg-prop-name">{key}:</span> <span className="qg-prop-value">{value}</span>
            </div>,
        );
    }

    const nodeClassName = cc([
        "qg-graph-node",
        {
            "qg-expanded": expanded,
            "qg-collapsed": hasProperties && !expanded,
            "qg-no-props": !hasProperties,
            // Node color reflects the node's content (precedence set in the loader):
            // costly scan (red) > index recommendation (amber) > index used (blue).
            "qg-node-costly-scan": data.highlightNode === "costly-scan",
            "qg-node-index-rec": data.highlightNode === "index-rec",
            "qg-node-index-used": data.highlightNode === "index-used",
            // A node can be a costly scan (red fill) AND carry an index recommendation. The fill can
            // only show one category, so surface the index-rec signal on the border in its amber hue
            // when another category won the fill — otherwise the recommendation would be invisible.
            "qg-node-index-rec-border": data.hasIndexRec && data.highlightNode !== "index-rec",
        },
    ]);

    const handleClassName = cc({
        "qg-subtree-handle": hasSubtree,
        "qg-expanded": hasSubtree && subtreeExpanded,
        "qg-collapsed": hasSubtree && !subtreeExpanded,
    });

    // A costly scan's node box is tinted proportionally to how many rows it read (heavier scans read
    // as a deeper red), via a CSS custom property the `.qg-node-costly-scan` rule consumes. Left unset
    // for other nodes, so the hover/expanded "white" state can still take over.
    const nodeStyle =
        data.highlightNode === "costly-scan" && data.costlyScanColor
            ? ({"--qg-costly-scan-color": data.costlyScanColor} as CSSProperties)
            : undefined;

    return (
        <>
            <Handle type="target" position={Position.Top} />
            <div className={nodeClassName} style={nodeStyle} onClick={onClick} title={data.highlightReason}>
                <div className="qg-graph-node-head" ref={headRef}>
                    <NodeIcon icon={data.icon} iconColor={data.iconColor} />
                    <div className="qg-graph-node-label" style={{background: data.nodeColor}}>
                        {data.name}
                    </div>
                </div>
                <div className="qg-graph-node-body-wrapper nowheel">
                    <div ref={bodyRef} className="qg-graph-node-body">
                        {children}
                    </div>
                </div>
            </div>
            <Handle type="source" position={Position.Bottom} className={handleClassName} onClick={onSubtreeHandleClick}>
                {hasSubtree ? (subtreeExpanded ? "-" : "+") : ""}
            </Handle>
        </>
    );
}

const memoizedQueryNode = memo(QueryNode);
export {memoizedQueryNode as QueryNode};

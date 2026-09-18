import type {ReactElement, MouseEvent, RefObject} from "react";
import {memo, useCallback, useRef, useEffect} from "react";
import type {Node, NodeProps} from "@xyflow/react";
import {Handle, Position} from "@xyflow/react";
import cc from "classcat";
import type {TreeNode} from "../tree-description";
import {NodeIcon} from "./NodeIcon";
import "./QueryNode.css";
import {useGraphRenderingStore} from "./store";
import {assert} from "../assert";

type NodeData = TreeNode & {resizeObserver: ResizeObserver};

export type QueryGraphNode = Node<NodeData, "querynode">;

function useResizeObservedRef<T extends Element>(resizeObserver: ResizeObserver): RefObject<T | null> {
    const ref = useRef<T>(null);
    useEffect(() => {
        assert(ref.current !== null);
        const currNode = ref.current;
        resizeObserver.observe(currNode);
        return () => resizeObserver.unobserve(currNode);
    }, [resizeObserver]);
    return ref;
}

function QueryNode({data, id}: NodeProps<QueryGraphNode>) {
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
    for (const [key, value] of (data.properties ?? new Map<string, string>()).entries()) {
        // A grouped property renders as a header row plus one sub-item per newline-separated `label: value`
        // line (the loader packs the sub-items into the value).
        if (data.groupedProperties?.has(key)) {
            children.push(
                <div key={key} className="qg-prop-group-header">
                    <span className="qg-prop-name">{key}:</span>
                </div>,
            );
            value.split("\n").forEach((line, i) => {
                const sep = line.indexOf(": ");
                const subKey = sep >= 0 ? line.slice(0, sep) : line;
                const subVal = sep >= 0 ? line.slice(sep + 2) : "";
                children.push(
                    <div key={`${key}-${i}`}>
                        <span className="qg-prop-name">- {subKey}:</span> <span className="qg-prop-value">{subVal}</span>
                    </div>,
                );
            });
            continue;
        }
        // A highlighted row (e.g. `cpu-cycles` on a hotspot) reuses the node-label color, so its tint intensity
        // matches the label exactly.
        const highlighted = data.highlightedProperties?.has(key);
        children.push(
            <div
                key={key}
                className={cc({"qg-prop-highlighted": highlighted})}
                style={highlighted ? {background: data.nodeColor} : undefined}
            >
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
        },
    ]);

    // A (possibly multi-color) bar drawn above and below the node.
    const colorBar = (colors: string[] | undefined, position: "above" | "below") =>
        colors?.length ? (
            <div className={cc(["qg-color-bar", `qg-color-bar-${position}`])}>
                {colors.map((c, i) => (
                    <span key={i} className="qg-color-bar-seg" style={{backgroundColor: c}} />
                ))}
            </div>
        ) : null;

    const handleClassName = cc({
        "qg-subtree-handle": hasSubtree,
        "qg-expanded": hasSubtree && subtreeExpanded,
        "qg-collapsed": hasSubtree && !subtreeExpanded,
    });

    return (
        <>
            <Handle type="target" position={Position.Top} />
            <div className={nodeClassName} onClick={onClick}>
                <div className="qg-graph-node-head" ref={headRef}>
                    {colorBar(data.barsAbove, "above")}
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
                {colorBar(data.barsBelow, "below")}
            </div>
            <Handle type="source" position={Position.Bottom} className={handleClassName} onClick={onSubtreeHandleClick}>
                {hasSubtree ? (subtreeExpanded ? "-" : "+") : ""}
            </Handle>
        </>
    );
}

const memoizedQueryNode = memo(QueryNode);
export {memoizedQueryNode as QueryNode};

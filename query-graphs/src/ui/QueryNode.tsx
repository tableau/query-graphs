import type {ReactElement, MouseEvent} from "react";
import {memo, useCallback} from "react";
import type {Node, NodeProps} from "@xyflow/react";
import {Handle, Position} from "@xyflow/react";
import cc from "classcat";
import type {TreeNode} from "../tree-description";
import {NodeIcon} from "./NodeIcon";
import "./QueryNode.css";
import {useGraphRenderingStore} from "./store";
import {subtreeHandleId, useAnimateGraphChange} from "./useAnimatedGraphLayout";

export type QueryGraphNode = Node<TreeNode, "querynode">;

function QueryNode({data, id}: NodeProps<QueryGraphNode>) {
    const expanded = useGraphRenderingStore((s) => s.expandedNodes[id]);
    const toggleNode = useGraphRenderingStore((s) => s.toggleExpandedNode);
    const subtreeExpanded = useGraphRenderingStore((s) => s.expandedSubtrees[id]);
    const toggleSubtree = useGraphRenderingStore((s) => s.toggleExpandedSubtree);
    const sourceHighlighted = useGraphRenderingStore((s) => s.highlightedNodes.has(data));
    const collapsedSubtreeHighlighted = useGraphRenderingStore((s) => s.highlightedCollapsedSubtreeRoots.has(data));
    const setHighlightedNode = useGraphRenderingStore((s) => s.setHighlightedNode);
    const animateGraphChange = useAnimateGraphChange();

    const hasProperties = data.properties?.size;
    const hasSubtree = data.collapsedChildren && data.collapsedChildren.length > 0;
    const hasSourceLocations = (data.sourceLocations?.length ?? 0) > 0;

    const onClick = useCallback(
        (e: MouseEvent<HTMLDivElement>) => {
            if (e.shiftKey) {
                if (hasSubtree) animateGraphChange(() => toggleSubtree(id));
            } else {
                if (hasProperties) {
                    animateGraphChange(() => toggleNode(id), [{nodeId: id, nodeElement: e.currentTarget}]);
                }
            }
            e.stopPropagation();
        },
        [animateGraphChange, toggleNode, toggleSubtree, hasProperties, hasSubtree, id],
    );
    const onSubtreeToggleClick = useCallback(
        (e: MouseEvent) => {
            if (hasSubtree) animateGraphChange(() => toggleSubtree(id));
            e.stopPropagation();
        },
        [animateGraphChange, toggleSubtree, hasSubtree, id],
    );

    const children = [] as ReactElement[];
    for (const [key, value] of (data.properties || []).entries()) {
        children.push(
            <div key={key}>
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
            "qg-source-highlighted": sourceHighlighted,
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

    const subtreeToggleClassName = cc([
        "qg-subtree-toggle",
        {
            "qg-expanded": subtreeExpanded,
            "qg-collapsed": !subtreeExpanded,
            "qg-source-descendant-highlighted": collapsedSubtreeHighlighted && !subtreeExpanded,
        },
    ]);
    const subtreeToggleLabel = `${subtreeExpanded ? "Collapse" : "Expand"} subtree${data.name ? ` for ${data.name}` : ""}`;

    return (
        <>
            <Handle type="target" position={Position.Top} />
            <div
                className={nodeClassName}
                onClick={onClick}
                onMouseEnter={() => setHighlightedNode(hasSourceLocations ? data : undefined)}
                onMouseLeave={() => setHighlightedNode(undefined)}
            >
                {colorBar(data.barsAbove, "above")}
                <div className="qg-graph-node-head">
                    <NodeIcon icon={data.icon} iconColor={data.iconColor} />
                    <div className="qg-graph-node-label" style={{background: data.nodeColor}}>
                        {data.name}
                    </div>
                </div>
                <div className="qg-graph-node-body-wrapper nowheel">
                    <div className="qg-graph-node-body">{children}</div>
                </div>
                {colorBar(data.barsBelow, "below")}
            </div>
            <Handle id={subtreeHandleId} type="source" position={Position.Bottom} />
            {hasSubtree ? (
                <button
                    type="button"
                    className={subtreeToggleClassName}
                    onClick={onSubtreeToggleClick}
                    aria-label={subtreeToggleLabel}
                    aria-expanded={!!subtreeExpanded}
                >
                    <svg className="qg-subtree-handle-icon" viewBox="0 0 16 16" aria-hidden="true">
                        <circle className="qg-subtree-handle-background" cx="8" cy="8" r="7.25" />
                        <path d="M4.5 8h7" />
                        <path className="qg-subtree-handle-vertical" d="M8 4.5v7" />
                    </svg>
                </button>
            ) : null}
        </>
    );
}

const memoizedQueryNode = memo(QueryNode);
export {memoizedQueryNode as QueryNode};

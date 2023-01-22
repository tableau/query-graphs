import { memo, ReactElement, MouseEvent, useCallback } from "react";
import { Handle, NodeProps, Position } from "reactflow";
import { TreeNode } from "../tree-description";
import { NodeIcon } from "./NodeIcon";
import "./QueryNode.css";
import { useGraphRenderingStore } from "./store";

function QueryNode({ data, id }: NodeProps<TreeNode>) {
    const expanded = useGraphRenderingStore((s) => s.expandedNodes[id]);
    const toggleNode = useGraphRenderingStore((s) => s.toggleExpandedNode);
    const toggleSubtree = useGraphRenderingStore((s) => s.toggleExpandedSubtree);
    const onClick = useCallback((e: MouseEvent) => {
        if (e.shiftKey)
            toggleNode(id);
        else
            toggleSubtree(id);
        e.stopPropagation();
        e.preventDefault();
    }, [toggleNode, id]);

    const children = [] as ReactElement[];
    for (const [key, value] of (data.properties || []).entries()) {
        children.push(
            <div>
                <span className="qg-prop-name">{key}:</span> {value}
            </div>,
        );
    }

    let className = "qg-graph-node";
    if (expanded) className += " qg-expanded";

    return (
        <>
            <Handle type="target" position={Position.Top} />
            <div className={className} onClick={onClick}>
                <NodeIcon icon={data.symbol} style={{ height: "1.5em" }} />
                <div style={{ textAlign: "center" }}>{data.name}</div>
                <div className="qg-graph-node-details">
                    <div className="qg-graph-node-details-inner">{children}</div>
                </div>
            </div>
            <Handle type="source" position={Position.Bottom} />
        </>
    );
}

const memoizedQueryNode = memo(QueryNode);
export { memoizedQueryNode as QueryNode };

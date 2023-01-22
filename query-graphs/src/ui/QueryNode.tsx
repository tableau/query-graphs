import { memo, ReactElement, MouseEvent, useCallback, useState } from "react";
import { Handle, NodeProps, Position } from "reactflow";
import { TreeNode } from "../tree-description";
import { NodeIcon } from "./NodeIcon";
import "./QueryNode.css";

function QueryNode({ data }: NodeProps<TreeNode>) {
    const [expanded, setExpanded] = useState(false);
    const toggleExpanded = useCallback((e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        setExpanded(!expanded);
    }, [expanded]);

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
            <div className={className} onClick={toggleExpanded}>
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

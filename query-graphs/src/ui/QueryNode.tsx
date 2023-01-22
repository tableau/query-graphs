import {memo, ReactElement, useCallback, useState} from "react";
import {Handle, NodeProps, Position} from "reactflow";
import {TreeNode} from "../tree-description";
import {NodeIcon} from "./NodeIcon";
import "./QueryNode.css";

function CollapsedQueryNode({data}: NodeProps<TreeNode>) {
    return (
        <div className="qg-collapsed-node">
            <NodeIcon icon={data.symbol} style={{height: "1.5em"}} />
            <div style={{textAlign: "center"}}>{data.name}</div>
        </div>
    );
}

function ExpandedQueryNode({data}: NodeProps<TreeNode>) {
    const children = [] as ReactElement[];
    for (const [key, value] of (data.properties || []).entries()) {
        children.push(
            <div>
                {key}: {value}
            </div>,
        );
    }
    return (
        <div className="qg-expanded-node">
            <NodeIcon icon={data.symbol} style={{height: "1.5em"}} />
            <div style={{textAlign: "center"}}>{data.name}</div>
            {children}
        </div>
    );
}

function QueryNode(props: NodeProps<TreeNode>) {
    const [expanded, setExpanded] = useState(false);
    const SelectedQueryNode = expanded ? ExpandedQueryNode : CollapsedQueryNode;
    const toggleExpanded = useCallback(() => setExpanded(!expanded), [expanded]);
    return (
        <div onClick={toggleExpanded}>
            <Handle type="target" position={Position.Top} />
            <SelectedQueryNode {...props} />
            <Handle type="source" position={Position.Bottom} />
        </div>
    );
}

const memoizedQueryNode = memo(QueryNode);
export {memoizedQueryNode as QueryNode};

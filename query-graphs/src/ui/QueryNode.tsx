import { memo } from "react";
import { Handle, NodeProps, Position } from "reactflow";
import { TreeNode } from "../tree-description";
import { NodeIcon } from "./NodeIcon";
import "./QueryNode.css"

function QueryNode({ data }: NodeProps<TreeNode>) {
    return (
        <>
            <Handle type="target" position={Position.Top} />
            <NodeIcon icon={data.symbol} style={{height: "1.5em"}} />
            <div style={{textAlign: "center"}}>{data.name}</div>
            <Handle type="source" position={Position.Bottom} />
        </>     
    );
}

const memoizedQueryNode = memo(QueryNode);
export { memoizedQueryNode as QueryNode };

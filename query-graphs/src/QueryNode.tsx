import {memo} from "react";
import {Handle, NodeProps, Position} from "reactflow";
import {TreeNode} from "./tree-description";

function QueryNode({data}: NodeProps<TreeNode>) {
    return (
        <>
            <Handle type="target" position={Position.Top} />
            <div>{data.name}</div>
            <Handle type="source" position={Position.Bottom} />
        </>
    );
}

const memoizedQueryNode = memo(QueryNode);
export {memoizedQueryNode as QueryNode};

import {memo} from "react";
import {Handle, NodeProps, Position} from "reactflow";
import {TreeNode} from "../tree-description";
import { NodeIcon } from "./NodeIcon";

function QueryNode({data}: NodeProps<TreeNode>) {
    return (
        <>
            <Handle type="target" position={Position.Top} />
            <NodeIcon icon={data.symbol} style={{height: "2em"}}/>
            <div>{data.name}</div>
            <Handle type="source" position={Position.Bottom} />
        </>
    );
}

const memoizedQueryNode = memo(QueryNode);
export {memoizedQueryNode as QueryNode};

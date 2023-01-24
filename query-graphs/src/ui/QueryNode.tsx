import {memo, ReactElement, MouseEvent, useCallback} from "react";
import {Handle, NodeProps, Position} from "reactflow";
import cc from "classcat";
import {TreeNode} from "../tree-description";
import {NodeIcon} from "./NodeIcon";
import "./QueryNode.css";
import {useGraphRenderingStore} from "./store";

function QueryNode({data, id}: NodeProps<TreeNode>) {
    const expanded = useGraphRenderingStore(s => s.expandedNodes[id]);
    const toggleNode = useGraphRenderingStore(s => s.toggleExpandedNode);
    const toggleSubtree = useGraphRenderingStore(s => s.toggleExpandedSubtree);
    const hasChildren = !!data._children;
    const onClick = useCallback(
        (e: MouseEvent) => {
            if (e.shiftKey) toggleSubtree(id);
            else if (hasChildren) toggleNode(id);
            e.stopPropagation();
            e.preventDefault();
        },
        [toggleNode, toggleSubtree, hasChildren, id],
    );

    const children = [] as ReactElement[];
    for (const [key, value] of (data.properties || []).entries()) {
        children.push(
            <div>
                <span className="qg-prop-name">{key}:</span> {value}
            </div>,
        );
    }

    const className = cc([
        "qg-graph-node",
        {
            "qg-expanded": expanded,
            "qg-collapsed": hasChildren,
        },
    ]);

    console.log(data.iconColor);
    return (
        <>
            <Handle type="target" position={Position.Top} />
            <div className={className} onClick={onClick}>
                <NodeIcon icon={data.icon} iconColor={data.iconColor} />
                <div className="qg-graph-node-label" style={{background: data.nodeColor}}>
                    {data.name}
                </div>
                <div className="qg-graph-node-details nowheel">
                    <div className="qg-graph-node-details-inner">{children}</div>
                </div>
            </div>
            <Handle type="source" position={Position.Bottom} />
        </>
    );
}

const memoizedQueryNode = memo(QueryNode);
export {memoizedQueryNode as QueryNode};

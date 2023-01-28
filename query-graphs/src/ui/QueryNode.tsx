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
    const subtreeExpanded = useGraphRenderingStore(s => s.expandedSubtrees[id]);
    const toggleSubtree = useGraphRenderingStore(s => s.toggleExpandedSubtree);
    const hasProperties = data.properties?.size;
    const hasSubtree = !!data._children;
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
        children.push(
            <div key={key}>
                <span className="qg-prop-name">{key}:</span> {value}
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

    const handleClassName = cc({
        "qg-subtree-handle": hasSubtree,
        "qg-expanded": hasSubtree && subtreeExpanded,
        "qg-collapsed": hasSubtree && !subtreeExpanded,
    });

    return (
        <>
            <Handle type="target" position={Position.Top} />
            <div className={nodeClassName} onClick={onClick}>
                <NodeIcon icon={data.icon} iconColor={data.iconColor} />
                <div className="qg-graph-node-label" style={{background: data.nodeColor}}>
                    {data.name}
                </div>
                <div className="qg-graph-node-details nowheel">
                    <div className="qg-graph-node-details-inner">
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

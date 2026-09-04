import type {ReactElement, MouseEvent} from "react";
import {memo, useCallback, useRef} from "react";
import type {Node, NodeProps} from "@xyflow/react";
import {Handle, Position} from "@xyflow/react";
import cc from "classcat";
import type {TreeNode} from "../tree-description";
import {NodeIcon} from "./NodeIcon";
import "./QueryNode.css";
import {useGraphRenderingStore} from "./store";
import {useGraphAnimationController} from "./useAnimatedGraphLayout";

export type QueryGraphNode = Node<TreeNode, "querynode">;

function QueryNode({data, id}: NodeProps<QueryGraphNode>) {
    const expanded = useGraphRenderingStore((s) => s.expandedNodes[id]);
    const toggleNode = useGraphRenderingStore((s) => s.toggleExpandedNode);
    const subtreeExpanded = useGraphRenderingStore((s) => s.expandedSubtrees[id]);
    const toggleSubtree = useGraphRenderingStore((s) => s.toggleExpandedSubtree);
    const animationController = useGraphAnimationController();

    const hasProperties = data.properties?.size;
    const hasSubtree = data.collapsedChildren && data.collapsedChildren.length > 0;
    const graphNodeRef = useRef<HTMLDivElement>(null);
    const bodyWrapperRef = useRef<HTMLDivElement>(null);

    const measureTargetDimensions = useCallback((targetExpanded: boolean) => {
        const graphNode = graphNodeRef.current;
        const flowNode = graphNode?.closest<HTMLElement>(".react-flow__node");
        if (graphNode === null || flowNode === null || flowNode === undefined) {
            return {node: {width: 50, height: 50}, body: {width: 0, height: 0}};
        }

        const clone = flowNode.cloneNode(true) as HTMLElement;
        const clonedGraphNode = clone.querySelector<HTMLElement>(".qg-graph-node");
        const clonedBodyWrapper = clone.querySelector<HTMLElement>(".qg-graph-node-body-wrapper");
        clone.style.position = "fixed";
        clone.style.transform = "none";
        clone.style.visibility = "hidden";
        clone.style.pointerEvents = "none";
        clonedGraphNode?.classList.toggle("qg-expanded", targetExpanded);
        clonedBodyWrapper?.style.removeProperty("width");
        clonedBodyWrapper?.style.removeProperty("height");
        clonedBodyWrapper?.style.removeProperty("max-width");
        clonedBodyWrapper?.style.removeProperty("max-height");
        flowNode.parentElement?.append(clone);
        const measurements = {
            node: {width: clone.offsetWidth, height: clone.offsetHeight},
            body: {width: clonedBodyWrapper?.offsetWidth ?? 0, height: clonedBodyWrapper?.offsetHeight ?? 0},
        };
        clone.remove();
        return measurements;
    }, []);

    const onClick = useCallback(
        (e: MouseEvent) => {
            if (e.shiftKey) {
                if (hasSubtree) animationController.animateSubtreeChange(id, () => toggleSubtree(id));
            } else {
                if (hasProperties) {
                    const target = measureTargetDimensions(!expanded);
                    const bodyWrapper = bodyWrapperRef.current;
                    if (bodyWrapper === null) {
                        toggleNode(id);
                    } else {
                        animationController.animateNodeResize(
                            {
                                nodeId: id,
                                targetDimensions: target.node,
                                bodyElement: bodyWrapper,
                                bodyFrom: {width: bodyWrapper.offsetWidth, height: bodyWrapper.offsetHeight},
                                bodyTo: target.body,
                            },
                            () => toggleNode(id),
                        );
                    }
                }
            }
            e.stopPropagation();
        },
        [animationController, toggleNode, toggleSubtree, hasProperties, hasSubtree, expanded, id, measureTargetDimensions],
    );
    const onSubtreeHandleClick = useCallback(
        (e: MouseEvent) => {
            if (hasSubtree) animationController.animateSubtreeChange(id, () => toggleSubtree(id));
            e.stopPropagation();
        },
        [animationController, toggleSubtree, hasSubtree, id],
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
            <div ref={graphNodeRef} className={nodeClassName} onClick={onClick}>
                <div className="qg-graph-node-head">
                    {colorBar(data.barsAbove, "above")}
                    <NodeIcon icon={data.icon} iconColor={data.iconColor} />
                    <div className="qg-graph-node-label" style={{background: data.nodeColor}}>
                        {data.name}
                    </div>
                </div>
                <div ref={bodyWrapperRef} className="qg-graph-node-body-wrapper nowheel">
                    <div className="qg-graph-node-body">{children}</div>
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

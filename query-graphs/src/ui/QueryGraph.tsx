import ReactFlow, {MiniMap, Node, Controls, ReactFlowProvider} from "reactflow";
import "reactflow/dist/base.css";

import {layoutTree} from "./tree-layout";
import {TreeDescription, TreeNode, allChildren, visitTreeNodes} from "../tree-description";
import {useMemo, useEffect, useRef} from "react";
import {QueryNode} from "./QueryNode";
import "./QueryGraph.css";
import {useGraphRenderingStore} from "./store";

interface QueryGraphProps {
    treeDescription: TreeDescription;
}

function minimapNodeColor(n: Node<TreeNode>): string {
    if (n.data.nodeColor) return n.data.nodeColor;
    if (n.data.iconColor) return n.data.iconColor;
    return "hsl(0, 0%, 72%)";
}

const nodeTypes = {
    querynode: QueryNode,
};

function QueryGraphInternal({treeDescription}: QueryGraphProps) {
    // Assign ids to all nodes
    const nodeIdMapping = useMemo(() => {
        let nextId = 0;
        const nodeIds = new Map<TreeNode, string>();
        visitTreeNodes(
            treeDescription.root,
            (d) => {
                nodeIds.set(d, "" + nextId++);
            },
            allChildren,
        );
        return nodeIds;
    }, [treeDescription]);

    // Initialize our state using the correct "expandedByDefault" state
    const initGraphStore = useGraphRenderingStore((s) => s.init);
    useMemo(() => {
        const expandedSubtrees = {};
        visitTreeNodes(
            treeDescription.root,
            (n) => {
                if (n.expandedByDefault) {
                    expandedSubtrees[nodeIdMapping.get(n)!] = true;
                }
            },
            allChildren,
        );
        initGraphStore(expandedSubtrees);
    }, [treeDescription, initGraphStore, nodeIdMapping]);

    // Create a ResizeObserver to keep track of the sizes of the nodes
    const resizeObserverRef = useRef<ResizeObserver>();
    const updateNodeDimensions = useGraphRenderingStore((s) => s.updateNodeDimensions);
    const resizeObserver = useMemo(() => {
        resizeObserverRef.current?.disconnect();
        const observer = new ResizeObserver(updateNodeDimensions);
        resizeObserverRef.current = observer;
        return observer;
    }, [updateNodeDimensions]);
    useEffect(() => {
        return () => {
            resizeObserverRef.current?.disconnect();
        };
    }, []);

    // Layout the tree, using the actual measured sizes of the DOM nodes
    const nodeDimensions = useGraphRenderingStore((s) => s.nodeDimensions);
    const expandedNodes = useGraphRenderingStore((s) => s.expandedNodes);
    const expandedSubtrees = useGraphRenderingStore((s) => s.expandedSubtrees);
    const layout = useMemo(
        () => layoutTree(treeDescription, nodeIdMapping, nodeDimensions, expandedNodes, expandedSubtrees, resizeObserver),
        [treeDescription, nodeIdMapping, nodeDimensions, expandedNodes, expandedSubtrees, resizeObserver],
    );

    return (
        <ReactFlow
            nodes={layout.nodes}
            edges={layout.edges}
            nodeOrigin={[0.5, 0]}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.2}
            maxZoom={1.5}
            elementsSelectable={true}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesFocusable={false}
            nodesFocusable={false}
            className={"query-graph"}
        >
            <MiniMap zoomable={true} pannable={true} nodeColor={minimapNodeColor} />
            <Controls showInteractive={false} />
        </ReactFlow>
    );
}

export function QueryGraph(props: QueryGraphProps) {
    return (
        <ReactFlowProvider>
            <QueryGraphInternal {...props} />
        </ReactFlowProvider>
    );
}

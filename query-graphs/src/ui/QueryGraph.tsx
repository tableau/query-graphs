import ReactFlow, {MiniMap, Node, Controls, ReactFlowProvider, useNodesInitialized} from "reactflow";
import "reactflow/dist/base.css";

import {layoutTree} from "./tree-layout";
import {TreeDescription, TreeNode} from "../tree-description";
import {useMemo} from "react";
import {QueryNode} from "./QueryNode";
import {useNodeSizes} from "./useNodeSizes";
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
    // Layout the tree, using the actual measured sizes of the DOM nodes
    const initialized = useNodesInitialized();
    const nodeSizes = useNodeSizes();
    const expandedSubtrees = useGraphRenderingStore(s => s.expandedSubtrees);
    const layout = useMemo(() => layoutTree(treeDescription, nodeSizes, expandedSubtrees), [
        treeDescription,
        nodeSizes,
        expandedSubtrees,
    ]);
    console.log({initialized, layout, nodeSizes});

    return (
        <ReactFlow
            nodes={layout.nodes}
            edges={layout.edges}
            nodeOrigin={[0.5, 0]}
            nodeTypes={nodeTypes}
            fitView
            maxZoom={2}
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

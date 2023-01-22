import ReactFlow, {MiniMap, Controls, ReactFlowProvider, useNodesInitialized} from "reactflow";
import "reactflow/dist/base.css";

import {layoutTree} from "./tree-layout";
import {TreeDescription} from "../tree-description";
import {useMemo} from "react";
import {QueryNode} from "./QueryNode";
import {useNodeSizes} from "./useNodeSizes";
import "./QueryGraph.css";

interface QueryGraphProps {
    treeDescription: TreeDescription;
}

function QueryGraphInternal({treeDescription}: QueryGraphProps) {
    // Layout the tree, using the actual measured sizes of the DOM nodes
    const initialized = useNodesInitialized();
    const nodeSizes = useNodeSizes();
    const layout = useMemo(() => layoutTree(treeDescription, nodeSizes), [treeDescription, nodeSizes]);
    console.log({initialized, layout, nodeSizes});

    const nodeTypes = useMemo(() => ({querynode: QueryNode}), []);

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
            <MiniMap zoomable={true} pannable={true} />
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

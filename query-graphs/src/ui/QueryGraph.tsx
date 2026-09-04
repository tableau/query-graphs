import {ReactFlow, MiniMap, Controls, ReactFlowProvider} from "@xyflow/react";
import "@xyflow/react/dist/base.css";

import type {TreeDescription, TreeNode} from "../tree-description";
import {allChildren, visitTreeNodes} from "../tree-description";
import type {ReactNode} from "react";
import {useMemo} from "react";
import {QueryNode} from "./QueryNode";
import type {QueryGraphNode} from "./QueryNode";
import {ColoredEdge} from "./ColoredEdge";
import {createGraphRenderingStore, GraphRenderingStoreContext, useGraphRenderingStore} from "./store";
import {GraphAnimationContext, useAnimatedGraphLayout} from "./useAnimatedGraphLayout";
import "./QueryGraph.css";

interface QueryGraphProps {
    treeDescription: TreeDescription;
    children: ReactNode | ReactNode[];
}

interface QueryGraphInternalProps extends QueryGraphProps {
    nodeIdMapping: Map<TreeNode, string>;
}

function minimapNodeColor(n: QueryGraphNode): string {
    if (n.data.nodeColor) return n.data.nodeColor;
    if (n.data.iconColor) return n.data.iconColor;
    return "hsl(0, 0%, 72%)";
}

const nodeTypes = {
    querynode: QueryNode,
};

const edgeTypes = {
    colored: ColoredEdge,
};

function QueryGraphInternal({treeDescription, children, nodeIdMapping}: QueryGraphInternalProps) {
    const expandedSubtrees = useGraphRenderingStore((s) => s.expandedSubtrees);
    const animatedLayout = useAnimatedGraphLayout(treeDescription, nodeIdMapping, expandedSubtrees);

    return (
        <GraphAnimationContext.Provider value={animatedLayout.animationController}>
            <ReactFlow
                nodes={animatedLayout.nodes}
                edges={animatedLayout.edges}
                nodeOrigin={[0.5, 0]}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={animatedLayout.onNodesChange}
                minZoom={0.2}
                maxZoom={1.5}
                elementsSelectable={true}
                nodesDraggable={false}
                nodesConnectable={false}
                nodesFocusable={false}
                className={"query-graph"}
            >
                {...Array.isArray(children) ? children : [children]}
                <MiniMap zoomable={true} pannable={true} nodeColor={minimapNodeColor} />
                <Controls showInteractive={false} />
            </ReactFlow>
        </GraphAnimationContext.Provider>
    );
}

function createGraphState(treeDescription: TreeDescription) {
    let nextNodeId = 0;
    const nodeIdMapping = new Map<TreeNode, string>();
    const expandedSubtrees: Record<string, boolean> = {};
    visitTreeNodes(
        treeDescription.root,
        (node) => {
            const id = "" + nextNodeId++;
            nodeIdMapping.set(node, id);
            if (node.expandedByDefault) expandedSubtrees[id] = true;
        },
        allChildren,
    );
    return {
        nodeIdMapping,
        graphStore: createGraphRenderingStore(expandedSubtrees),
    };
}

export function QueryGraph(props: QueryGraphProps) {
    const {nodeIdMapping, graphStore} = useMemo(() => createGraphState(props.treeDescription), [props.treeDescription]);

    return (
        <ReactFlowProvider>
            <GraphRenderingStoreContext.Provider value={graphStore}>
                <QueryGraphInternal {...props} nodeIdMapping={nodeIdMapping} />
            </GraphRenderingStoreContext.Provider>
        </ReactFlowProvider>
    );
}

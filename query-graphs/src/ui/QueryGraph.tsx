import {ReactFlow, MiniMap, MiniMapNode, Controls, ReactFlowProvider} from "@xyflow/react";
import type {MiniMapNodeProps} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type {TreeDescription, TreeNode} from "../tree-description";
import {allChildren, visitTreeNodes} from "../tree-description";
import type {MouseEvent, ReactNode} from "react";
import {useMemo} from "react";
import cc from "classcat";
import {QueryNode} from "./QueryNode";
import type {QueryGraphNode} from "./QueryNode";
import {ColoredEdge} from "./ColoredEdge";
import {createGraphRenderingStore, GraphRenderingStoreContext, useGraphRenderingStore} from "./store";
import {AnimateGraphChangeContext, useAnimatedGraphLayout} from "./useAnimatedGraphLayout";
import {indexGraph} from "./graph-index";
import type {TreeParents} from "./tree-topology";
import "./QueryGraph.css";

interface QueryGraphProps {
    treeDescription: TreeDescription;
    children: ReactNode | ReactNode[];
}

interface QueryGraphInternalProps extends QueryGraphProps {
    nodeIdMapping: Map<TreeNode, string>;
    treeParents: TreeParents;
}

function minimapNodeColor(n: QueryGraphNode): string {
    if (n.data.nodeColor) return n.data.nodeColor;
    if (n.data.iconColor) return n.data.iconColor;
    return "hsl(0, 0%, 72%)";
}

function QueryGraphMiniMapNode(props: MiniMapNodeProps) {
    const highlighted = useGraphRenderingStore((state) => state.visibleHighlightedNodeIds.has(props.id));
    return <MiniMapNode {...props} className={cc([props.className, {"qg-highlighted": highlighted}])} />;
}

const nodeTypes = {
    querynode: QueryNode,
};

const edgeTypes = {
    colored: ColoredEdge,
};

function preventNodeDoubleClickZoom(event: MouseEvent): void {
    if (event.target instanceof Element && event.target.closest(".react-flow__node") !== null) event.stopPropagation();
}

function QueryGraphInternal({treeDescription, children, nodeIdMapping, treeParents}: QueryGraphInternalProps) {
    const expandedSubtrees = useGraphRenderingStore((s) => s.expandedSubtrees);
    const animatedLayout = useAnimatedGraphLayout(treeDescription, nodeIdMapping, treeParents, expandedSubtrees);
    // Hide the full tree initially to avoid flickering. We use `opacity` instead
    // of `visibility: hidden` because React Flow overrides inherited
    // visibility on nodes after measuring them.
    const initialViewportStyle = {opacity: animatedLayout.initialViewportReady ? 1 : 0};

    return (
        <AnimateGraphChangeContext.Provider value={animatedLayout.animateGraphChange}>
            <ReactFlow
                nodes={animatedLayout.nodes}
                edges={animatedLayout.edges}
                nodeOrigin={[0.5, 0]}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={animatedLayout.onNodesChange}
                onDoubleClickCapture={preventNodeDoubleClickZoom}
                minZoom={0.2}
                maxZoom={1.5}
                elementsSelectable={true}
                nodesDraggable={false}
                nodesConnectable={false}
                nodesFocusable={false}
                className={"query-graph"}
                style={initialViewportStyle}
                inert={!animatedLayout.initialViewportReady}
            >
                {...Array.isArray(children) ? children : [children]}
                <MiniMap zoomable={true} pannable={true} nodeColor={minimapNodeColor} nodeComponent={QueryGraphMiniMapNode} />
                <Controls showInteractive={false} />
            </ReactFlow>
        </AnimateGraphChangeContext.Provider>
    );
}

let nextGraphInstanceId = 0;

function createGraphState(treeDescription: TreeDescription) {
    let nextId = 0;
    const nodeIdMapping = new Map<TreeNode, string>();
    const expandedSubtrees: Record<string, boolean> = {};
    visitTreeNodes(
        treeDescription.root,
        (node) => {
            const id = "" + nextId++;
            nodeIdMapping.set(node, id);
            if (node.expandedByDefault) expandedSubtrees[id] = true;
        },
        allChildren,
    );
    const graphIndex = indexGraph(treeDescription, nodeIdMapping);
    return {
        instanceId: nextGraphInstanceId++,
        nodeIdMapping,
        graphIndex,
        graphStore: createGraphRenderingStore({expandedSubtrees, graphIndex}),
    };
}

export function QueryGraph(props: QueryGraphProps) {
    const {instanceId, nodeIdMapping, graphIndex, graphStore} = useMemo(
        () => createGraphState(props.treeDescription),
        [props.treeDescription],
    );

    // This artificial key remounts React Flow when the tree changes, keeping
    // its viewport, measurements, and animation state scoped to one graph.
    return (
        <ReactFlowProvider key={instanceId}>
            <GraphRenderingStoreContext.Provider value={graphStore}>
                <QueryGraphInternal {...props} nodeIdMapping={nodeIdMapping} treeParents={graphIndex.treeTopology.parents} />
            </GraphRenderingStoreContext.Provider>
        </ReactFlowProvider>
    );
}

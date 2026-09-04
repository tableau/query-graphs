import type {NodeChange} from "@xyflow/react";
import {ReactFlow, MiniMap, Controls, ReactFlowProvider} from "@xyflow/react";
import "@xyflow/react/dist/base.css";

import {layoutTree} from "./tree-layout";
import type {TreeDescription, TreeNode} from "../tree-description";
import {allChildren, visitTreeNodes} from "../tree-description";
import type {ReactNode} from "react";
import {useCallback, useMemo} from "react";
import {QueryNode} from "./QueryNode";
import type {QueryGraphNode} from "./QueryNode";
import {ColoredEdge} from "./ColoredEdge";
import {createGraphRenderingStore, GraphRenderingStoreContext, useGraphRenderingStore} from "./store";
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
    // Keep React Flow's measurements in the controlled node objects. Dropping them when
    // recomputing the layout makes React Flow repeatedly hide and re-initialize the nodes.
    const nodeDimensions = useGraphRenderingStore((s) => s.nodeDimensions);
    const updateNodeDimensions = useGraphRenderingStore((s) => s.updateNodeDimensions);
    const onNodesChange = useCallback(
        (changes: NodeChange<QueryGraphNode>[]) => {
            const updates = changes.flatMap((change) => {
                if (change.type !== "dimensions" || change.dimensions === undefined) return [];
                return [[change.id, change.dimensions] as const];
            });
            updateNodeDimensions(updates);
        },
        [updateNodeDimensions],
    );

    // Layout the tree using the dimensions measured by React Flow itself.
    const expandedSubtrees = useGraphRenderingStore((s) => s.expandedSubtrees);
    const layout = useMemo(
        () => layoutTree(treeDescription, nodeIdMapping, nodeDimensions, expandedSubtrees),
        [treeDescription, nodeIdMapping, nodeDimensions, expandedSubtrees],
    );

    return (
        <ReactFlow
            nodes={layout.nodes}
            edges={layout.edges}
            nodeOrigin={[0.5, 0]}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            fitView
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
    );
}

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

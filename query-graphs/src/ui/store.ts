import {createContext, useContext} from "react";
import {useStore} from "zustand";
import {createStore} from "zustand/vanilla";
import type {StoreApi} from "zustand/vanilla";
import {assertNotNull} from "../assert";
import type {SourceLocation, TreeNode} from "../tree-description";
import type {GraphIndex} from "./graph-index";
import {createStructuralNodeVisibility, findClosestVisibleAncestors} from "./tree-topology";

interface SourceHighlightSelection {
    /** Identifies the document allowed to clear this selection after its pointer or focus leaves. */
    documentId: string;
    /** Retained by identity to ignore duplicate editor notifications. */
    sourceLocations: readonly SourceLocation[];
    /** Nodes linked to the active source locations. */
    nodeIds: ReadonlySet<string>;
}

interface HighlightState {
    /** Semantically highlighted nodes, including nodes hidden in collapsed subtrees. */
    highlightedNodeIds: ReadonlySet<string>;
    /** The closest structurally visible tree nodes representing `highlightedNodeIds`. */
    visibleHighlightedNodeIds: ReadonlySet<string>;
    /** Visible ancestors standing in for highlighted descendants, whose subtree handles should draw attention. */
    highlightedCollapsedAncestorIds: ReadonlySet<string>;
}

const noNodeIds: ReadonlySet<string> = new Set();

export interface GraphRenderingState extends HighlightState {
    // `expandedNodes` contains every expandable node and tracks which ones are expanded.
    expandedNodes: Record<string, boolean>;
    toggleExpandedNode: (nodeId: string) => void;
    setAllNodesExpanded: (expanded: boolean) => void;
    // `expandedSubtrees` tracks which nodes reveal their `collapsedChildren` (toggled by shift-click or the +/- handle).
    expandedSubtrees: Record<string, boolean>;
    toggleExpandedSubtree: (nodeId: string) => void;
    /** Highlights nodes under the pointer, taking precedence over source and keyboard-focus highlights. */
    setHoveredNodeIds: (nodeIds?: ReadonlySet<string>) => void;
    /** Highlights keyboard-focused nodes when neither pointer nor source highlights are active. */
    setFocusedNodeIds: (nodeIds?: ReadonlySet<string>) => void;
    /** Returns the graph-local ID assigned to a tree node, if that node belongs to this graph. */
    getNodeId: (node: TreeNode) => string | undefined;
    /** Updates the semantic node highlights from the exact linked ranges active in one document. */
    setActiveSourceLocations: (documentId: string, sourceLocations: readonly SourceLocation[]) => void;
    /** Returns every range that should participate in pointer and caret linking for one document. */
    getLinkedSourceRanges: (documentId: string) => readonly SourceLocation[];
    /** Derives the ranges a document should highlight for the semantic node highlights. */
    getSourceRangesForNodes: (documentId: string, nodeIds: ReadonlySet<string>) => readonly SourceLocation[];
}

export type GraphRenderingStore = StoreApi<GraphRenderingState>;

export interface GraphRenderingStoreOptions {
    /** Static node identities, topology, and source associations for the lifetime of this graph store. */
    graphIndex: GraphIndex;
}

export function createGraphRenderingStore({graphIndex}: GraphRenderingStoreOptions): GraphRenderingStore {
    let sourceHighlightSelection: SourceHighlightSelection | undefined;
    let hoveredNodeIds: ReadonlySet<string> | undefined;
    let focusedNodeIds: ReadonlySet<string> | undefined;
    const initialExpandedNodes = Object.fromEntries(
        [...graphIndex.nodeIds].flatMap(([node, nodeId]) => (node.properties?.size ? [[nodeId, false]] : [])),
    );
    const initialExpandedSubtrees = Object.fromEntries(
        [...graphIndex.nodeIds].flatMap(([node, nodeId]) => (node.expandedByDefault ? [[nodeId, true]] : [])),
    );

    return createStore<GraphRenderingState>()((set) => {
        // Materialize the visible tree projection once per interaction so each rendered node can subscribe to a boolean.
        const resolveHighlights = (currentExpandedSubtrees: Readonly<Record<string, boolean>>): HighlightState => {
            const highlightedNodeIds = hoveredNodeIds ?? sourceHighlightSelection?.nodeIds ?? focusedNodeIds ?? noNodeIds;
            const visibleNodeIds = createStructuralNodeVisibility(
                currentExpandedSubtrees,
                graphIndex.treeTopology.parents,
                graphIndex.treeTopology.collapsedSubtreeRootIds,
            );
            const closestAncestors = findClosestVisibleAncestors(
                highlightedNodeIds,
                graphIndex.treeTopology.parents,
                visibleNodeIds,
            );
            const visibleHighlightedNodeIds = new Set<string>();
            const highlightedCollapsedAncestorIds = new Set<string>();
            for (const [highlightedNodeId, visibleNodeId] of closestAncestors) {
                if (visibleNodeId === undefined) continue;
                visibleHighlightedNodeIds.add(visibleNodeId);
                if (highlightedNodeId !== visibleNodeId) highlightedCollapsedAncestorIds.add(visibleNodeId);
            }
            return {highlightedNodeIds, visibleHighlightedNodeIds, highlightedCollapsedAncestorIds};
        };

        return {
            expandedNodes: initialExpandedNodes,
            expandedSubtrees: initialExpandedSubtrees,
            toggleExpandedNode: (nodeId) =>
                set((state) => ({
                    expandedNodes: {
                        ...state.expandedNodes,
                        [nodeId]: !state.expandedNodes[nodeId],
                    },
                })),
            setAllNodesExpanded: (expanded) =>
                set({
                    expandedNodes: Object.fromEntries(Object.keys(initialExpandedNodes).map((nodeId) => [nodeId, expanded])),
                }),
            toggleExpandedSubtree: (nodeId) =>
                set((state) => {
                    const nextExpandedSubtrees = {
                        ...state.expandedSubtrees,
                        [nodeId]: !state.expandedSubtrees[nodeId],
                    };
                    return {expandedSubtrees: nextExpandedSubtrees, ...resolveHighlights(nextExpandedSubtrees)};
                }),
            highlightedNodeIds: noNodeIds,
            visibleHighlightedNodeIds: noNodeIds,
            highlightedCollapsedAncestorIds: noNodeIds,
            setHoveredNodeIds: (nodeIds) => {
                if (hoveredNodeIds === nodeIds) return;
                hoveredNodeIds = nodeIds?.size ? nodeIds : undefined;
                set((state) => resolveHighlights(state.expandedSubtrees));
            },
            setFocusedNodeIds: (nodeIds) => {
                if (focusedNodeIds === nodeIds) return;
                focusedNodeIds = nodeIds?.size ? nodeIds : undefined;
                set((state) => resolveHighlights(state.expandedSubtrees));
            },
            getNodeId: (node) => graphIndex.nodeIds.get(node),
            setActiveSourceLocations: (documentId, sourceLocations) => {
                // An editor can report an empty selection after another document has already become active.
                if (sourceLocations.length === 0 && sourceHighlightSelection?.documentId !== documentId) return;
                if (
                    sourceHighlightSelection?.documentId === documentId &&
                    sourceHighlightSelection.sourceLocations === sourceLocations
                )
                    return;
                sourceHighlightSelection =
                    sourceLocations.length === 0
                        ? undefined
                        : {
                              documentId,
                              sourceLocations,
                              nodeIds: graphIndex.sourceLinks.getNodeIdsForRanges(sourceLocations),
                          };
                set((state) => resolveHighlights(state.expandedSubtrees));
            },
            getLinkedSourceRanges: graphIndex.sourceLinks.getLinkedRanges,
            getSourceRangesForNodes: graphIndex.sourceLinks.getRangesForNodeIds,
        };
    });
}

export const GraphRenderingStoreContext = createContext<GraphRenderingStore | null>(null);

export function useGraphRenderingStore<T>(selector: (state: GraphRenderingState) => T): T {
    const store = useContext(GraphRenderingStoreContext);
    assertNotNull(store);
    return useStore(store, selector);
}

import {createContext, useContext} from "react";
import {useStore} from "zustand";
import {createStore} from "zustand/vanilla";
import type {StoreApi} from "zustand/vanilla";
import {assertNotNull} from "../assert";
import type {SourceLocation} from "../tree-description";
import type {GraphIndex} from "./graph-index";
import {createStructuralNodeVisibility, findClosestVisibleAncestors} from "./tree-topology";

interface ActiveSourceSelection {
    /** Identifies the document allowed to clear this selection after its pointer or focus leaves. */
    documentId: string;
    /** Retained by identity to ignore duplicate editor notifications. */
    sourceLocations: readonly SourceLocation[];
    /** Semantic selection restored after a temporary tree-node hover ends. */
    nodeIds: ReadonlySet<string>;
}

interface HighlightState {
    /** The semantic selection. These IDs remain unchanged when their nodes are hidden in collapsed subtrees. */
    activeNodeIds: ReadonlySet<string>;
    /** The closest structurally visible tree nodes representing `activeNodeIds`. */
    highlightedNodeIds: ReadonlySet<string>;
    /** Visible ancestors standing in for active descendants, whose subtree handles should draw attention. */
    highlightedCollapsedSubtreeRootIds: ReadonlySet<string>;
}

const noNodeIds: ReadonlySet<string> = new Set();

export interface GraphRenderingState extends HighlightState {
    // `expandedNodes` tracks which nodes show their property detail panel (toggled by a plain click).
    expandedNodes: Record<string, boolean>;
    toggleExpandedNode: (nodeId: string) => void;
    // `expandedSubtrees` tracks which nodes reveal their `collapsedChildren` (toggled by shift-click or the +/- handle).
    expandedSubtrees: Record<string, boolean>;
    toggleExpandedSubtree: (nodeId: string) => void;
    /** Temporarily replaces the source-derived active nodes while a linked tree node is hovered. */
    setHoveredNodeId: (nodeId?: string) => void;
    /** Updates the semantic node selection from the exact linked ranges active in one document. */
    setActiveSourceLocations: (documentId: string, sourceLocations: readonly SourceLocation[]) => void;
    /** Returns every range that should participate in pointer and caret linking for one document. */
    getLinkedSourceRanges: (documentId: string) => readonly SourceLocation[];
    /** Derives the ranges a document should highlight for the semantic node selection. */
    getSourceRangesForNodes: (documentId: string, nodeIds: ReadonlySet<string>) => readonly SourceLocation[];
}

export type GraphRenderingStore = StoreApi<GraphRenderingState>;

export interface GraphRenderingStoreOptions {
    expandedSubtrees: Record<string, boolean>;
    /** Static topology and source associations for the lifetime of this graph store. */
    graphIndex: GraphIndex;
}

export function createGraphRenderingStore({expandedSubtrees, graphIndex}: GraphRenderingStoreOptions): GraphRenderingStore {
    let activeSourceSelection: ActiveSourceSelection | undefined;
    let hoveredNodeId: string | undefined;

    return createStore<GraphRenderingState>()((set) => {
        // Materialize the visible tree projection once per interaction so each rendered node can subscribe to a boolean.
        const resolveHighlights = (currentExpandedSubtrees: Readonly<Record<string, boolean>>): HighlightState => {
            const activeNodeIds =
                hoveredNodeId === undefined ? (activeSourceSelection?.nodeIds ?? noNodeIds) : new Set([hoveredNodeId]);
            const visibleNodeIds = createStructuralNodeVisibility(
                currentExpandedSubtrees,
                graphIndex.treeTopology.parents,
                graphIndex.treeTopology.collapsedSubtreeRootIds,
            );
            const closestAncestors = findClosestVisibleAncestors(activeNodeIds, graphIndex.treeTopology.parents, visibleNodeIds);
            const highlightedNodeIds = new Set<string>();
            const highlightedCollapsedSubtreeRootIds = new Set<string>();
            for (const [activeNodeId, visibleNodeId] of closestAncestors) {
                if (visibleNodeId === undefined) continue;
                highlightedNodeIds.add(visibleNodeId);
                if (activeNodeId !== visibleNodeId) highlightedCollapsedSubtreeRootIds.add(visibleNodeId);
            }
            return {activeNodeIds, highlightedNodeIds, highlightedCollapsedSubtreeRootIds};
        };

        return {
            expandedNodes: {},
            expandedSubtrees,
            toggleExpandedNode: (nodeId) =>
                set((state) => ({
                    expandedNodes: {
                        ...state.expandedNodes,
                        [nodeId]: !state.expandedNodes[nodeId],
                    },
                })),
            toggleExpandedSubtree: (nodeId) =>
                set((state) => {
                    const nextExpandedSubtrees = {
                        ...state.expandedSubtrees,
                        [nodeId]: !state.expandedSubtrees[nodeId],
                    };
                    return {expandedSubtrees: nextExpandedSubtrees, ...resolveHighlights(nextExpandedSubtrees)};
                }),
            activeNodeIds: noNodeIds,
            highlightedNodeIds: noNodeIds,
            highlightedCollapsedSubtreeRootIds: noNodeIds,
            setHoveredNodeId: (nodeId) => {
                if (hoveredNodeId === nodeId) return;
                hoveredNodeId = nodeId;
                set((state) => resolveHighlights(state.expandedSubtrees));
            },
            setActiveSourceLocations: (documentId, sourceLocations) => {
                // An editor can report an empty selection after another document has already become active.
                if (sourceLocations.length === 0 && activeSourceSelection?.documentId !== documentId) return;
                if (activeSourceSelection?.documentId === documentId && activeSourceSelection.sourceLocations === sourceLocations)
                    return;
                activeSourceSelection =
                    sourceLocations.length === 0
                        ? undefined
                        : {
                              documentId,
                              sourceLocations,
                              nodeIds: graphIndex.sourceLinks.getNodeIdsForRanges(documentId, sourceLocations),
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

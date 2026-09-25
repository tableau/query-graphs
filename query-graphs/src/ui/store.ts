import {createContext, useContext} from "react";
import {useStore} from "zustand";
import {createStore} from "zustand/vanilla";
import type {StoreApi} from "zustand/vanilla";
import {assertNotNull} from "../assert";
import type {SourceLocation, TreeNode} from "../tree-description";
import {createSourceLinkIndex} from "./source-link-index";
import {createStructuralNodeVisibility, findClosestVisibleAncestors, type TreeIndex} from "./tree-index";

interface ActiveSourceSelection {
    documentId: string;
    sourceLocations: readonly SourceLocation[];
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
    setHoveredNodeId: (nodeId?: string) => void;
    setActiveSourceLocations: (documentId: string, sourceLocations: readonly SourceLocation[]) => void;
    getLinkedSourceRanges: (documentId: string) => readonly SourceLocation[];
    getSourceRangesForNodes: (documentId: string, nodeIds: ReadonlySet<string>) => readonly SourceLocation[];
}

export type GraphRenderingStore = StoreApi<GraphRenderingState>;

export interface GraphRenderingStoreOptions {
    expandedSubtrees?: Record<string, boolean>;
    nodeIds?: ReadonlyMap<TreeNode, string>;
    treeIndex?: TreeIndex;
}

export function createGraphRenderingStore({
    expandedSubtrees = {},
    nodeIds = new Map(),
    treeIndex = {parents: new Map(), collapsedSubtreeRootIds: new Set()},
}: GraphRenderingStoreOptions = {}): GraphRenderingStore {
    const sourceLinkIndex = createSourceLinkIndex(nodeIds);
    let activeSourceSelection: ActiveSourceSelection | undefined;
    let hoveredNodeId: string | undefined;

    return createStore<GraphRenderingState>()((set) => {
        const resolveHighlights = (currentExpandedSubtrees: Readonly<Record<string, boolean>>): HighlightState => {
            const activeNodeIds =
                hoveredNodeId === undefined ? (activeSourceSelection?.nodeIds ?? noNodeIds) : new Set([hoveredNodeId]);
            const visibleNodeIds = createStructuralNodeVisibility(
                currentExpandedSubtrees,
                treeIndex.parents,
                treeIndex.collapsedSubtreeRootIds,
            );
            const closestAncestors = findClosestVisibleAncestors(activeNodeIds, treeIndex.parents, visibleNodeIds);
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
                if (sourceLocations.length === 0 && activeSourceSelection?.documentId !== documentId) return;
                if (activeSourceSelection?.documentId === documentId && activeSourceSelection.sourceLocations === sourceLocations)
                    return;
                activeSourceSelection =
                    sourceLocations.length === 0
                        ? undefined
                        : {
                              documentId,
                              sourceLocations,
                              nodeIds: sourceLinkIndex.getNodeIdsForRanges(documentId, sourceLocations),
                          };
                set((state) => resolveHighlights(state.expandedSubtrees));
            },
            getLinkedSourceRanges: sourceLinkIndex.getLinkedRanges,
            getSourceRangesForNodes: sourceLinkIndex.getRangesForNodeIds,
        };
    });
}

export const GraphRenderingStoreContext = createContext<GraphRenderingStore | null>(null);

export function useGraphRenderingStore<T>(selector: (state: GraphRenderingState) => T): T {
    const store = useContext(GraphRenderingStoreContext);
    assertNotNull(store);
    return useStore(store, selector);
}

import {createContext, useContext} from "react";
import {useStore} from "zustand";
import {createStore} from "zustand/vanilla";
import type {StoreApi} from "zustand/vanilla";
import {assertNotNull} from "../assert";
import type {SourceLocation} from "../tree-description";
import type {GraphIndex} from "./graph-index";
import {createStructuralNodeVisibility, findClosestVisibleAncestors} from "./tree-topology";

interface SourceHighlightSelection {
    /** Identifies the document allowed to clear this selection after its pointer or focus leaves. */
    documentId: string;
    /** Retained by identity to ignore duplicate editor notifications. */
    sourceLocations: readonly SourceLocation[];
    /** Semantic highlights restored after a temporary tree-node hover ends. */
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

export interface NodeRevealRequest {
    id: number;
    documentId: string;
    nodeIds: ReadonlySet<string>;
}

const noNodeIds: ReadonlySet<string> = new Set();

export interface GraphRenderingState extends HighlightState {
    // `expandedNodes` tracks which nodes show their property detail panel (toggled by a plain click).
    expandedNodes: Record<string, boolean>;
    toggleExpandedNode: (nodeId: string) => void;
    // `expandedSubtrees` tracks which nodes reveal their `collapsedChildren` (toggled by shift-click or the +/- handle).
    expandedSubtrees: Record<string, boolean>;
    toggleExpandedSubtree: (nodeId: string) => void;
    /** Temporarily replaces the source-derived highlights while a linked tree node is hovered. */
    setHoveredNodeId: (nodeId?: string) => void;
    /** Updates the semantic node highlights from the exact linked ranges active in one document. */
    setActiveSourceLocations: (documentId: string, sourceLocations: readonly SourceLocation[]) => void;
    /** Enables or disables viewport navigation for highlights originating in one source document. */
    setFollowSourceDocument: (documentId: string, follow: boolean) => void;
    /** Requests that the graph reveal the visible nodes linked from an opted-in source document. */
    nodeRevealRequest?: NodeRevealRequest;
    /** Returns every range that should participate in pointer and caret linking for one document. */
    getLinkedSourceRanges: (documentId: string) => readonly SourceLocation[];
    /** Derives the ranges a document should highlight for the semantic node highlights. */
    getSourceRangesForNodes: (documentId: string, nodeIds: ReadonlySet<string>) => readonly SourceLocation[];
}

export type GraphRenderingStore = StoreApi<GraphRenderingState>;

export interface GraphRenderingStoreOptions {
    expandedSubtrees: Record<string, boolean>;
    /** Static topology and source associations for the lifetime of this graph store. */
    graphIndex: GraphIndex;
}

export function createGraphRenderingStore({expandedSubtrees, graphIndex}: GraphRenderingStoreOptions): GraphRenderingStore {
    let sourceHighlightSelection: SourceHighlightSelection | undefined;
    let hoveredNodeId: string | undefined;
    const followedSourceDocumentIds = new Set<string>();
    let nextNodeRevealRequestId = 0;

    return createStore<GraphRenderingState>()((set) => {
        const projectNodeHighlights = (
            highlightedNodeIds: ReadonlySet<string>,
            currentExpandedSubtrees: Readonly<Record<string, boolean>>,
        ): HighlightState => {
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
        // Materialize the visible tree projection once per interaction so each rendered node can subscribe to a boolean.
        const resolveHighlights = (currentExpandedSubtrees: Readonly<Record<string, boolean>>): HighlightState =>
            projectNodeHighlights(
                hoveredNodeId === undefined ? (sourceHighlightSelection?.nodeIds ?? noNodeIds) : new Set([hoveredNodeId]),
                currentExpandedSubtrees,
            );
        const createNodeRevealRequest = (
            currentExpandedSubtrees: Readonly<Record<string, boolean>>,
        ): NodeRevealRequest | undefined => {
            if (sourceHighlightSelection === undefined || !followedSourceDocumentIds.has(sourceHighlightSelection.documentId))
                return undefined;
            const nodeIds = projectNodeHighlights(
                sourceHighlightSelection.nodeIds,
                currentExpandedSubtrees,
            ).visibleHighlightedNodeIds;
            if (nodeIds.size === 0) return undefined;
            return {
                id: nextNodeRevealRequestId++,
                documentId: sourceHighlightSelection.documentId,
                nodeIds,
            };
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
            highlightedNodeIds: noNodeIds,
            visibleHighlightedNodeIds: noNodeIds,
            highlightedCollapsedAncestorIds: noNodeIds,
            setHoveredNodeId: (nodeId) => {
                if (hoveredNodeId === nodeId) return;
                hoveredNodeId = nodeId;
                set((state) => resolveHighlights(state.expandedSubtrees));
            },
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
                set((state) => ({
                    ...resolveHighlights(state.expandedSubtrees),
                    nodeRevealRequest: createNodeRevealRequest(state.expandedSubtrees),
                }));
            },
            setFollowSourceDocument: (documentId, follow) => {
                if (follow === followedSourceDocumentIds.has(documentId)) return;
                if (follow) followedSourceDocumentIds.add(documentId);
                else followedSourceDocumentIds.delete(documentId);
                if (sourceHighlightSelection?.documentId === documentId)
                    set((state) => ({nodeRevealRequest: createNodeRevealRequest(state.expandedSubtrees)}));
            },
            nodeRevealRequest: undefined,
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

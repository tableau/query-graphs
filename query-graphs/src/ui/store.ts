import {createContext, useContext} from "react";
import {useStore} from "zustand";
import {createStore} from "zustand/vanilla";
import type {StoreApi} from "zustand/vanilla";
import {assertNotNull} from "../assert";
import type {SourceLocation, TreeNode} from "../tree-description";
import {findClosestVisibleAncestors, type TreeParents} from "./tree-index";

interface SourceNodeEntry {
    location: SourceLocation;
    nodeId: string;
    maxTo: number;
}

interface SourceNodeIndex {
    entriesByDocument: Map<string, SourceNodeEntry[]>;
    linkedRangesByDocument: Map<string, readonly SourceLocation[]>;
}

const noSourceRanges: readonly SourceLocation[] = [];

function createSourceNodeIndex(nodeIds: ReadonlyMap<TreeNode, string>): SourceNodeIndex {
    const entriesByDocument = new Map<string, SourceNodeEntry[]>();
    for (const [node, nodeId] of nodeIds) {
        for (const location of node.sourceLocations ?? []) {
            if (
                !Number.isSafeInteger(location.from) ||
                !Number.isSafeInteger(location.to) ||
                location.from < 0 ||
                location.from >= location.to
            )
                continue;
            const entries = entriesByDocument.get(location.documentId) ?? [];
            entries.push({location, nodeId, maxTo: location.to});
            entriesByDocument.set(location.documentId, entries);
        }
    }

    const linkedRangesByDocument = new Map<string, readonly SourceLocation[]>();
    for (const [documentId, entries] of entriesByDocument) {
        entries.sort((left, right) => left.location.from - right.location.from || left.location.to - right.location.to);
        let maxTo = -1;
        for (const entry of entries) {
            maxTo = Math.max(maxTo, entry.location.to);
            entry.maxTo = maxTo;
        }
        const seen = new Set<string>();
        linkedRangesByDocument.set(
            documentId,
            entries.flatMap(({location}) => {
                const key = `${location.from}:${location.to}`;
                if (seen.has(key)) return [];
                seen.add(key);
                return [location];
            }),
        );
    }
    return {entriesByDocument, linkedRangesByDocument};
}

function sourceMatchesAtOffset(
    index: SourceNodeIndex,
    documentId: string,
    offset: number,
): {nodeIds: Set<string>; locations: SourceLocation[]} {
    const entries = index.entriesByDocument.get(documentId);
    if (entries === undefined) return {nodeIds: new Set(), locations: []};

    let low = 0;
    let high = entries.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (entries[middle].location.from <= offset) low = middle + 1;
        else high = middle;
    }

    let shortestRange = Infinity;
    const matchingNodeIds = new Set<string>();
    let matchingLocations: SourceLocation[] = [];
    for (let index = low - 1; index >= 0 && entries[index].maxTo > offset; index--) {
        const entry = entries[index];
        const {from, to} = entry.location;
        if (offset >= to) continue;
        const rangeLength = to - from;
        if (rangeLength < shortestRange) {
            shortestRange = rangeLength;
            matchingNodeIds.clear();
            matchingLocations = [];
        }
        if (rangeLength === shortestRange) {
            matchingNodeIds.add(entry.nodeId);
            if (!matchingLocations.some(({from, to}) => from === entry.location.from && to === entry.location.to))
                matchingLocations.push(entry.location);
        }
    }
    return {nodeIds: matchingNodeIds, locations: matchingLocations};
}

function equalSets<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
    return left.size === right.size && Array.from(left).every((value) => right.has(value));
}

export interface GraphRenderingState {
    // `expandedNodes` tracks which nodes show their property detail panel (toggled by a plain click).
    expandedNodes: Record<string, boolean>;
    toggleExpandedNode: (nodeId: string) => void;
    // `expandedSubtrees` tracks which nodes reveal their `collapsedChildren` (toggled by shift-click or the +/- handle).
    expandedSubtrees: Record<string, boolean>;
    toggleExpandedSubtree: (nodeId: string) => void;
    highlightedNodes: ReadonlySet<TreeNode>;
    highlightedCollapsedSubtreeRoots: ReadonlySet<TreeNode>;
    highlightedSourceLocations: readonly SourceLocation[];
    setHighlightedNode: (node?: TreeNode) => void;
    highlightNodesAtSourceRangeOffset: (documentId: string, sourceRangeOffset?: number) => void;
    setVisibleNodeIds: (nodeIds: ReadonlySet<string>) => void;
    getLinkedSourceRanges: (documentId: string) => readonly SourceLocation[];
}

export type GraphRenderingStore = StoreApi<GraphRenderingState>;

export function createGraphRenderingStore(
    expandedSubtrees: Record<string, boolean>,
    nodeIds: ReadonlyMap<TreeNode, string> = new Map(),
    treeParents: TreeParents = new Map(),
): GraphRenderingStore {
    const sourceNodeIndex = createSourceNodeIndex(nodeIds);
    const nodesById = new Map(Array.from(nodeIds, ([node, id]) => [id, node]));
    let visibleNodeIds: ReadonlySet<string> = new Set(nodesById.keys());
    let sourceHighlightedNodeIds = new Set<string>();
    let sourceHighlightedLocations: readonly SourceLocation[] = [];
    let activeSourceDocumentId: string | undefined;
    let activeSourceRangeOffset: number | undefined;
    let hoveredNode: TreeNode | undefined;
    const resolveVisibleHighlights = (): {
        highlightedNodes: ReadonlySet<TreeNode>;
        highlightedCollapsedSubtreeRoots: ReadonlySet<TreeNode>;
    } => {
        const closestAncestors = findClosestVisibleAncestors(sourceHighlightedNodeIds, treeParents, visibleNodeIds);
        const highlightedNodes = new Set<TreeNode>();
        const highlightedCollapsedSubtreeRoots = new Set<TreeNode>();
        for (const [sourceNodeId, visibleNodeId] of closestAncestors) {
            const node = visibleNodeId === undefined ? undefined : nodesById.get(visibleNodeId);
            if (node === undefined) continue;
            highlightedNodes.add(node);
            if (sourceNodeId !== visibleNodeId) highlightedCollapsedSubtreeRoots.add(node);
        }
        return {highlightedNodes, highlightedCollapsedSubtreeRoots};
    };
    const publishHighlights = (set: (partial: Partial<GraphRenderingState>) => void) => {
        const visibleHighlights =
            hoveredNode === undefined
                ? resolveVisibleHighlights()
                : {highlightedNodes: new Set([hoveredNode]), highlightedCollapsedSubtreeRoots: new Set<TreeNode>()};
        const highlightedSourceLocations = hoveredNode?.sourceLocations ?? sourceHighlightedLocations;
        set({...visibleHighlights, highlightedSourceLocations});
    };

    return createStore<GraphRenderingState>()((set) => ({
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
            set((state) => ({
                expandedSubtrees: {
                    ...state.expandedSubtrees,
                    [nodeId]: !state.expandedSubtrees[nodeId],
                },
            })),
        highlightedNodes: new Set(),
        highlightedCollapsedSubtreeRoots: new Set(),
        highlightedSourceLocations: [],
        setHighlightedNode: (node) => {
            if (hoveredNode === node) return;
            hoveredNode = node;
            publishHighlights(set);
        },
        highlightNodesAtSourceRangeOffset: (documentId, sourceRangeOffset) => {
            if (sourceRangeOffset === undefined && activeSourceDocumentId !== documentId) return;
            if (activeSourceDocumentId === documentId && activeSourceRangeOffset === sourceRangeOffset) return;
            const matches =
                sourceRangeOffset === undefined
                    ? {nodeIds: new Set<string>(), locations: []}
                    : sourceMatchesAtOffset(sourceNodeIndex, documentId, sourceRangeOffset);
            sourceHighlightedNodeIds = matches.nodeIds;
            sourceHighlightedLocations = matches.locations;
            activeSourceDocumentId = sourceRangeOffset === undefined ? undefined : documentId;
            activeSourceRangeOffset = sourceRangeOffset;
            publishHighlights(set);
        },
        setVisibleNodeIds: (nodeIds) => {
            if (equalSets(visibleNodeIds, nodeIds)) return;
            visibleNodeIds = nodeIds;
            if (activeSourceDocumentId !== undefined && hoveredNode === undefined) {
                set((state) => {
                    const highlights = resolveVisibleHighlights();
                    return equalSets(state.highlightedNodes, highlights.highlightedNodes) &&
                        equalSets(state.highlightedCollapsedSubtreeRoots, highlights.highlightedCollapsedSubtreeRoots)
                        ? state
                        : highlights;
                });
            }
        },
        getLinkedSourceRanges: (documentId) => sourceNodeIndex.linkedRangesByDocument.get(documentId) ?? noSourceRanges,
    }));
}

export const GraphRenderingStoreContext = createContext<GraphRenderingStore | null>(null);

export function useGraphRenderingStore<T>(selector: (state: GraphRenderingState) => T): T {
    const store = useContext(GraphRenderingStoreContext);
    assertNotNull(store);
    return useStore(store, selector);
}

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
}

interface SourceNodeIndex {
    nodeIdsByDocumentAndRange: Map<string, Map<string, ReadonlySet<string>>>;
    linkedRangesByDocument: Map<string, readonly SourceLocation[]>;
}

const noSourceRanges: readonly SourceLocation[] = [];

function createSourceNodeIndex(nodeIds: ReadonlyMap<TreeNode, string>): SourceNodeIndex {
    const entriesByDocument = new Map<string, SourceNodeEntry[]>();
    const nodeIdsByDocumentAndRange = new Map<string, Map<string, Set<string>>>();
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
            entries.push({location, nodeId});
            entriesByDocument.set(location.documentId, entries);
            const nodeIdsByRange = nodeIdsByDocumentAndRange.get(location.documentId) ?? new Map<string, Set<string>>();
            const rangeKey = `${location.from}:${location.to}`;
            const rangeNodeIds = nodeIdsByRange.get(rangeKey) ?? new Set<string>();
            rangeNodeIds.add(nodeId);
            nodeIdsByRange.set(rangeKey, rangeNodeIds);
            nodeIdsByDocumentAndRange.set(location.documentId, nodeIdsByRange);
        }
    }

    const linkedRangesByDocument = new Map<string, readonly SourceLocation[]>();
    for (const [documentId, entries] of entriesByDocument) {
        entries.sort((left, right) => left.location.from - right.location.from || left.location.to - right.location.to);
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
    return {nodeIdsByDocumentAndRange, linkedRangesByDocument};
}

function nodeIdsForSourceLocations(
    index: SourceNodeIndex,
    documentId: string,
    sourceLocations: readonly SourceLocation[],
): Set<string> {
    const nodeIdsByRange = index.nodeIdsByDocumentAndRange.get(documentId);
    const matchingNodeIds = new Set<string>();
    if (nodeIdsByRange === undefined) return matchingNodeIds;
    for (const {documentId: locationDocumentId, from, to} of sourceLocations) {
        if (locationDocumentId !== documentId) continue;
        for (const nodeId of nodeIdsByRange.get(`${from}:${to}`) ?? []) matchingNodeIds.add(nodeId);
    }
    return matchingNodeIds;
}

function equalSets<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
    return left.size === right.size && Array.from(left).every((value) => right.has(value));
}

function equalSourceLocations(left: readonly SourceLocation[], right: readonly SourceLocation[]): boolean {
    return (
        left.length === right.length &&
        left.every(
            (location, index) =>
                location.documentId === right[index].documentId &&
                location.from === right[index].from &&
                location.to === right[index].to,
        )
    );
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
    setActiveSourceLocations: (documentId: string, sourceLocations: readonly SourceLocation[]) => void;
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
        setActiveSourceLocations: (documentId, sourceLocations) => {
            if (sourceLocations.length === 0 && activeSourceDocumentId !== documentId) return;
            if (activeSourceDocumentId === documentId && equalSourceLocations(sourceHighlightedLocations, sourceLocations)) return;
            sourceHighlightedNodeIds = nodeIdsForSourceLocations(sourceNodeIndex, documentId, sourceLocations);
            sourceHighlightedLocations = sourceLocations;
            activeSourceDocumentId = sourceLocations.length === 0 ? undefined : documentId;
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

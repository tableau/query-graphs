import type {SourceLocation, TreeNode} from "../tree-description";

interface IndexedSourceRange {
    location: SourceLocation;
    nodeIds: Set<string>;
}

export interface SourceLinkIndex {
    /** Returns the stable, sorted range list made interactive in one document. */
    getLinkedRanges: (documentId: string) => readonly SourceLocation[];
    /** Resolves exact ranges reported by an editor to every node associated with them. */
    getNodeIdsForRanges: (documentId: string, sourceLocations: readonly SourceLocation[]) => ReadonlySet<string>;
    /** Returns the sorted, deduplicated ranges associated with the supplied nodes in one document. */
    getRangesForNodeIds: (documentId: string, nodeIds: ReadonlySet<string>) => readonly SourceLocation[];
}

// Zustand selectors require a stable snapshot when a document has no linked ranges.
const noSourceRanges: readonly SourceLocation[] = [];

function sourceRangeKey({from, to}: SourceLocation): string {
    return `${from}:${to}`;
}

function validSourceRange({from, to}: SourceLocation): boolean {
    return Number.isSafeInteger(from) && Number.isSafeInteger(to) && from >= 0 && from < to;
}

function compareSourceRanges(left: SourceLocation, right: SourceLocation): number {
    return left.from - right.from || left.to - right.to;
}

/** Builds the immutable bidirectional source-range index shared by tree and document interactions. */
export function createSourceLinkIndex(nodeIds: ReadonlyMap<TreeNode, string>): SourceLinkIndex {
    const rangesByDocument = new Map<string, Map<string, IndexedSourceRange>>();
    const sourceRangesByNodeId = new Map<string, readonly SourceLocation[]>();
    for (const [node, nodeId] of nodeIds) {
        const validLocations = (node.sourceLocations ?? []).filter(validSourceRange);
        if (validLocations.length > 0) sourceRangesByNodeId.set(nodeId, validLocations);
        for (const location of validLocations) {
            const documentRanges = rangesByDocument.get(location.documentId) ?? new Map<string, IndexedSourceRange>();
            const rangeKey = sourceRangeKey(location);
            // Preserve one canonical SourceLocation object per document range so editor identity comparisons stay stable.
            const indexedRange = documentRanges.get(rangeKey) ?? {location, nodeIds: new Set<string>()};
            indexedRange.nodeIds.add(nodeId);
            documentRanges.set(rangeKey, indexedRange);
            rangesByDocument.set(location.documentId, documentRanges);
        }
    }

    const linkedRangesByDocument = new Map<string, readonly SourceLocation[]>();
    for (const [documentId, ranges] of rangesByDocument) {
        linkedRangesByDocument.set(documentId, Array.from(ranges.values(), ({location}) => location).sort(compareSourceRanges));
    }

    return {
        getLinkedRanges: (documentId) => linkedRangesByDocument.get(documentId) ?? noSourceRanges,
        getNodeIdsForRanges: (documentId, sourceLocations) => {
            const documentRanges = rangesByDocument.get(documentId);
            const matchingNodeIds = new Set<string>();
            if (documentRanges === undefined) return matchingNodeIds;
            for (const location of sourceLocations) {
                if (location.documentId !== documentId) continue;
                for (const nodeId of documentRanges.get(sourceRangeKey(location))?.nodeIds ?? []) matchingNodeIds.add(nodeId);
            }
            return matchingNodeIds;
        },
        getRangesForNodeIds: (documentId, nodeIds) => {
            const matchingRanges = new Map<string, SourceLocation>();
            for (const nodeId of nodeIds) {
                for (const location of sourceRangesByNodeId.get(nodeId) ?? []) {
                    if (location.documentId === documentId) matchingRanges.set(sourceRangeKey(location), location);
                }
            }
            if (matchingRanges.size === 0) return noSourceRanges;
            return Array.from(matchingRanges.values()).sort(compareSourceRanges);
        },
    };
}

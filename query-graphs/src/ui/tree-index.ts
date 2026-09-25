import {assertNotNull} from "../assert";
import type {TreeDescription, TreeNode} from "../tree-description";

export type TreeParents = ReadonlyMap<string, string>;

export interface TreeIndex {
    parents: TreeParents;
    collapsedSubtreeRootIds: ReadonlySet<string>;
}

/** Indexes every parent edge and distinguishes the roots of collapsible subtrees. */
export function indexTree(tree: TreeDescription, nodeIds: ReadonlyMap<TreeNode, string>): TreeIndex {
    const parents = new Map<string, string>();
    const collapsedSubtreeRootIds = new Set<string>();
    const pending: [TreeNode, string | undefined, boolean][] = [[tree.root, undefined, false]];
    while (pending.length > 0) {
        const [node, parentId, collapsedSubtreeRoot] = pending.pop()!;
        const nodeId = nodeIds.get(node);
        assertNotNull(nodeId);
        if (parentId !== undefined) parents.set(nodeId, parentId);
        if (collapsedSubtreeRoot) collapsedSubtreeRootIds.add(nodeId);
        for (const child of node.children ?? []) pending.push([child, nodeId, false]);
        for (const child of node.collapsedChildren ?? []) pending.push([child, nodeId, true]);
    }
    return {parents, collapsedSubtreeRootIds};
}

/** Creates a lazy visibility lookup for the current expanded-subtree state. */
export function createStructuralNodeVisibility(
    expandedSubtrees: Readonly<Record<string, boolean>>,
    treeParents: TreeParents,
    collapsedSubtreeRootIds: Pick<ReadonlySet<string>, "has">,
): Pick<ReadonlySet<string>, "has"> {
    const visibility = new Map<string, boolean>();
    return {
        has(nodeId) {
            const path: string[] = [];
            let childId: string | undefined = nodeId;
            let visible = true;
            while (childId !== undefined) {
                const cached = visibility.get(childId);
                if (cached !== undefined) {
                    visible = cached;
                    break;
                }
                path.push(childId);
                const parentId = treeParents.get(childId);
                if (parentId !== undefined && collapsedSubtreeRootIds.has(childId) && !expandedSubtrees[parentId]) {
                    visible = false;
                    break;
                }
                childId = parentId;
            }
            for (const traversedId of path) visibility.set(traversedId, visible);
            return visible;
        },
    };
}

/**
 * Finds the closest visible ancestor of each supplied node, including the node
 * itself when visible. Resolved paths are cached so shared ancestry is only
 * walked once, even for deep hidden subtrees.
 */
export function findClosestVisibleAncestors(
    nodeIds: Iterable<string>,
    parents: TreeParents,
    visibleNodeIds: Pick<ReadonlySet<string>, "has">,
): ReadonlyMap<string, string | undefined> {
    const resolvedAncestors = new Map<string, string | undefined>();
    const closestAncestors = new Map<string, string | undefined>();
    for (const nodeId of nodeIds) {
        const path: string[] = [];
        let ancestor: string | undefined = nodeId;
        while (ancestor !== undefined && !visibleNodeIds.has(ancestor)) {
            if (resolvedAncestors.has(ancestor)) {
                ancestor = resolvedAncestors.get(ancestor);
                break;
            }
            path.push(ancestor);
            ancestor = parents.get(ancestor);
        }
        for (const traversed of path) resolvedAncestors.set(traversed, ancestor);
        closestAncestors.set(nodeId, ancestor);
    }
    return closestAncestors;
}

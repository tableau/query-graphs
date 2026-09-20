import {assertNotNull} from "../assert";
import type {TreeDescription, TreeNode} from "../tree-description";
import {allChildren} from "../tree-description";

export type TreeParents = ReadonlyMap<string, string>;

/** Indexes every node's parent once, including currently collapsed children. */
export function indexTreeParents(tree: TreeDescription, nodeIds: ReadonlyMap<TreeNode, string>): TreeParents {
    const parents = new Map<string, string>();
    const pending: [TreeNode, string | undefined][] = [[tree.root, undefined]];
    while (pending.length > 0) {
        const [node, parentId] = pending.pop()!;
        const nodeId = nodeIds.get(node);
        assertNotNull(nodeId);
        if (parentId !== undefined) parents.set(nodeId, parentId);
        for (const child of allChildren(node)) pending.push([child, nodeId]);
    }
    return parents;
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

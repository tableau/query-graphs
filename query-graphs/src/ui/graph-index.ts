import {allChildren, visitTreeNodes} from "../tree-description";
import type {TreeDescription, TreeNode} from "../tree-description";
import {createSourceLinkIndex, type SourceLinkIndex} from "./source-link-index";
import {indexTreeTopology, type TreeTopology} from "./tree-topology";

export interface GraphIndex {
    /** Stable rendering IDs for every node in the complete tree. */
    nodeIds: ReadonlyMap<TreeNode, string>;
    /** Tree topology used by layout and visible-highlight resolution. */
    treeTopology: TreeTopology;
    /** Bidirectional associations used to synchronize tree and document interactions. */
    sourceLinks: SourceLinkIndex;
}

/** Builds all immutable indexes that share the lifetime of one rendered graph. */
export function indexGraph(tree: TreeDescription): GraphIndex {
    const nodeIds = new Map<TreeNode, string>();
    visitTreeNodes(tree.root, (node) => nodeIds.set(node, "" + nodeIds.size), allChildren);
    return {
        nodeIds,
        treeTopology: indexTreeTopology(tree, nodeIds),
        sourceLinks: createSourceLinkIndex(nodeIds),
    };
}

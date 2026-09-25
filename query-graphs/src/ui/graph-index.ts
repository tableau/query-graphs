import type {TreeDescription, TreeNode} from "../tree-description";
import {createSourceLinkIndex, type SourceLinkIndex} from "./source-link-index";
import {indexTreeTopology, type TreeTopology} from "./tree-topology";

export interface GraphIndex {
    /** Tree topology used by layout and visible-highlight resolution. */
    treeTopology: TreeTopology;
    /** Bidirectional associations used to synchronize tree and document interactions. */
    sourceLinks: SourceLinkIndex;
}

/** Builds all immutable indexes that share the lifetime of one rendered graph. */
export function indexGraph(tree: TreeDescription, nodeIds: ReadonlyMap<TreeNode, string>): GraphIndex {
    return {
        treeTopology: indexTreeTopology(tree, nodeIds),
        sourceLinks: createSourceLinkIndex(nodeIds),
    };
}

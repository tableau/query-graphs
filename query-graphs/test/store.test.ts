import assert from "node:assert/strict";
import test from "node:test";
import type {TreeNode} from "../src/tree-description";
import {createSourceLinkIndex} from "../src/ui/source-link-index";
import {createGraphRenderingStore} from "../src/ui/store";

function graphStore(
    nodes: TreeNode[],
    parents: ReadonlyMap<string, string> = new Map(),
    collapsedSubtreeRootIds: ReadonlySet<string> = new Set(),
) {
    const nodeIds = new Map(nodes.map((node, index) => [node, `${index}`]));
    return createGraphRenderingStore({
        expandedSubtrees: {},
        graphIndex: {
            treeTopology: {parents, collapsedSubtreeRootIds},
            sourceLinks: createSourceLinkIndex(nodeIds),
        },
    });
}

// Exact ranges, rather than merely containing ranges, determine the semantic node highlights.
test("source locations select every node linked to the active ranges", () => {
    const outer: TreeNode = {sourceLocations: [{documentId: "query", from: 10, to: 20}]};
    const first: TreeNode = {sourceLocations: [{documentId: "query", from: 12, to: 16}]};
    const second: TreeNode = {sourceLocations: [{documentId: "query", from: 12, to: 16}]};
    const store = graphStore([outer, first, second]);

    store.getState().setActiveSourceLocations("query", [{documentId: "query", from: 12, to: 16}]);
    assert.deepEqual(store.getState().highlightedNodeIds, new Set(["1", "2"]));
    assert.deepEqual(store.getState().visibleHighlightedNodeIds, new Set(["1", "2"]));
    store.getState().setActiveSourceLocations("query", [{documentId: "query", from: 10, to: 20}]);
    assert.deepEqual(store.getState().visibleHighlightedNodeIds, new Set(["0"]));
    store.getState().setActiveSourceLocations("query", []);
    assert.deepEqual(store.getState().highlightedNodeIds, new Set());
    assert.deepEqual(store.getState().visibleHighlightedNodeIds, new Set());
});

// Hidden semantic highlights project onto the nearest visible ancestor until its collapsed subtree is expanded.
test("active source locations resolve hidden nodes to visible ancestors", () => {
    const root: TreeNode = {};
    const hidden: TreeNode = {sourceLocations: [{documentId: "query", from: 0, to: 5}]};
    const store = graphStore([root, hidden], new Map([["1", "0"]]), new Set(["1"]));

    store.getState().setActiveSourceLocations("query", [{documentId: "query", from: 0, to: 5}]);
    assert.deepEqual(store.getState().highlightedNodeIds, new Set(["1"]));
    assert.deepEqual(store.getState().visibleHighlightedNodeIds, new Set(["0"]));
    assert.deepEqual(store.getState().highlightedCollapsedAncestorIds, new Set(["0"]));
    store.getState().toggleExpandedSubtree("0");
    assert.deepEqual(store.getState().visibleHighlightedNodeIds, new Set(["1"]));
    assert.deepEqual(store.getState().highlightedCollapsedAncestorIds, new Set());
});

// Tree hover is transient and must restore the editor-derived highlights without accepting stale clears from other documents.
test("tree-node hover temporarily overrides and then restores source highlighting", () => {
    const node: TreeNode = {
        sourceLocations: [
            {documentId: "query", from: 0, to: 5},
            {documentId: "query", from: 10, to: 15},
        ],
    };
    const hovered: TreeNode = {sourceLocations: [{documentId: "query", from: 20, to: 25}]};
    const store = graphStore([node, hovered]);

    store.getState().setActiveSourceLocations("query", [{documentId: "query", from: 0, to: 5}]);
    assert.deepEqual(store.getState().visibleHighlightedNodeIds, new Set(["0"]));
    store.getState().setHoveredNodeId("1");
    assert.deepEqual(store.getState().highlightedNodeIds, new Set(["1"]));
    assert.deepEqual(store.getState().visibleHighlightedNodeIds, new Set(["1"]));
    store.getState().setHoveredNodeId(undefined);
    assert.deepEqual(store.getState().highlightedNodeIds, new Set(["0"]));
    assert.deepEqual(store.getState().visibleHighlightedNodeIds, new Set(["0"]));

    store.getState().setActiveSourceLocations("plan", []);
    assert.deepEqual(store.getState().visibleHighlightedNodeIds, new Set(["0"]));
    store.getState().setActiveSourceLocations("query", []);
    assert.deepEqual(store.getState().highlightedNodeIds, new Set());
});

// CodeMirror can report the same range-array instance repeatedly; ignoring it avoids unnecessary Zustand rerenders.
test("repeated active source locations do not republish highlight state", () => {
    const node: TreeNode = {sourceLocations: [{documentId: "query", from: 0, to: 5}]};
    const store = graphStore([node]);
    let updates = 0;
    const unsubscribe = store.subscribe(() => updates++);

    const sourceLocations = [{documentId: "query", from: 0, to: 5}];
    store.getState().setActiveSourceLocations("query", sourceLocations);
    const highlightedNodeIds = store.getState().highlightedNodeIds;
    const visibleHighlightedNodeIds = store.getState().visibleHighlightedNodeIds;
    store.getState().setActiveSourceLocations("query", sourceLocations);

    assert.equal(updates, 1);
    assert.equal(store.getState().highlightedNodeIds, highlightedNodeIds);
    assert.equal(store.getState().visibleHighlightedNodeIds, visibleHighlightedNodeIds);
    unsubscribe();
});

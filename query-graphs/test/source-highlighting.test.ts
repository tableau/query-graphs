import assert from "node:assert/strict";
import test from "node:test";
import type {TreeNode} from "../src/tree-description";
import {createGraphRenderingStore} from "../src/ui/store";

function graphStore(nodes: TreeNode[], parents: ReadonlyMap<string, string> = new Map()) {
    return createGraphRenderingStore({}, new Map(nodes.map((node, index) => [node, `${index}`])), parents);
}

test("source locations select every node linked to the active ranges", () => {
    const outer: TreeNode = {sourceLocations: [{documentId: "query", from: 10, to: 20}]};
    const first: TreeNode = {sourceLocations: [{documentId: "query", from: 12, to: 16}]};
    const second: TreeNode = {sourceLocations: [{documentId: "query", from: 12, to: 16}]};
    const store = graphStore([outer, first, second]);

    store.getState().setActiveSourceLocations("query", [{documentId: "query", from: 12, to: 16}]);
    assert.deepEqual(store.getState().highlightedNodes, new Set([first, second]));
    store.getState().setActiveSourceLocations("query", [{documentId: "query", from: 10, to: 20}]);
    assert.deepEqual(store.getState().highlightedNodes, new Set([outer]));
    store.getState().setActiveSourceLocations("query", []);
    assert.deepEqual(store.getState().highlightedNodes, new Set());
    assert.deepEqual(store.getState().getLinkedSourceRanges("query"), [
        {documentId: "query", from: 10, to: 20},
        {documentId: "query", from: 12, to: 16},
    ]);
});

test("active source locations resolve hidden nodes to visible ancestors", () => {
    const root: TreeNode = {};
    const hidden: TreeNode = {sourceLocations: [{documentId: "query", from: 0, to: 5}]};
    const store = graphStore([root, hidden], new Map([["1", "0"]]));

    store.getState().setVisibleNodeIds(new Set(["0"]));
    store.getState().setActiveSourceLocations("query", [{documentId: "query", from: 0, to: 5}]);
    assert.deepEqual(store.getState().highlightedNodes, new Set([root]));
    assert.deepEqual(store.getState().highlightedCollapsedSubtreeRoots, new Set([root]));
    assert.deepEqual(store.getState().highlightedSourceLocations, [{documentId: "query", from: 0, to: 5}]);
    store.getState().setVisibleNodeIds(new Set(["0", "1"]));
    assert.deepEqual(store.getState().highlightedNodes, new Set([hidden]));
    assert.deepEqual(store.getState().highlightedCollapsedSubtreeRoots, new Set());
});

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
    assert.deepEqual(store.getState().highlightedNodes, new Set([node]));
    store.getState().setHighlightedNode(hovered);
    assert.deepEqual(store.getState().highlightedNodes, new Set([hovered]));
    assert.deepEqual(store.getState().highlightedSourceLocations, hovered.sourceLocations);
    store.getState().setHighlightedNode(undefined);
    assert.deepEqual(store.getState().highlightedNodes, new Set([node]));
    assert.deepEqual(store.getState().highlightedSourceLocations, [node.sourceLocations?.[0]]);

    store.getState().setActiveSourceLocations("plan", []);
    assert.deepEqual(store.getState().highlightedNodes, new Set([node]));
    store.getState().setActiveSourceLocations("query", []);
    assert.deepEqual(store.getState().highlightedNodes, new Set());
});

test("malformed source ranges do not participate in highlighting", () => {
    const malformed: TreeNode = {sourceLocations: [{documentId: "query", from: 0, to: Number.NaN}]};
    const valid: TreeNode = {sourceLocations: [{documentId: "query", from: 10, to: 20}]};
    const store = graphStore([malformed, valid]);

    store.getState().setActiveSourceLocations("query", [{documentId: "query", from: 10, to: 20}]);
    assert.deepEqual(store.getState().highlightedNodes, new Set([valid]));
});

test("repeated active source locations do not republish highlight state", () => {
    const node: TreeNode = {sourceLocations: [{documentId: "query", from: 0, to: 5}]};
    const store = graphStore([node]);
    let updates = 0;
    const unsubscribe = store.subscribe(() => updates++);

    const sourceLocations = [{documentId: "query", from: 0, to: 5}];
    store.getState().setActiveSourceLocations("query", sourceLocations);
    const highlightedNodes = store.getState().highlightedNodes;
    const highlightedSourceLocations = store.getState().highlightedSourceLocations;
    store.getState().setActiveSourceLocations("query", sourceLocations);

    assert.equal(updates, 1);
    assert.equal(store.getState().highlightedNodes, highlightedNodes);
    assert.equal(store.getState().highlightedSourceLocations, highlightedSourceLocations);
    unsubscribe();
});

test("documents without source locations have a stable empty snapshot", () => {
    const store = graphStore([]);

    const first = store.getState().getLinkedSourceRanges("plan");
    const second = store.getState().getLinkedSourceRanges("plan");
    assert.equal(first, second);
    assert.deepEqual(first, []);
});

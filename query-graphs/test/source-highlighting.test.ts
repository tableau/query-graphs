import assert from "node:assert/strict";
import test from "node:test";
import type {TreeNode} from "../src/tree-description";
import {createGraphRenderingStore} from "../src/ui/store";

function graphStore(
    nodes: TreeNode[],
    parents: ReadonlyMap<string, string> = new Map(),
    collapsedSubtreeRootIds: ReadonlySet<string> = new Set(),
) {
    return createGraphRenderingStore({
        nodeIds: new Map(nodes.map((node, index) => [node, `${index}`])),
        treeIndex: {parents, collapsedSubtreeRootIds},
    });
}

test("source locations select every node linked to the active ranges", () => {
    const outer: TreeNode = {sourceLocations: [{documentId: "query", from: 10, to: 20}]};
    const first: TreeNode = {sourceLocations: [{documentId: "query", from: 12, to: 16}]};
    const second: TreeNode = {sourceLocations: [{documentId: "query", from: 12, to: 16}]};
    const store = graphStore([outer, first, second]);

    store.getState().setActiveSourceLocations("query", [{documentId: "query", from: 12, to: 16}]);
    assert.deepEqual(store.getState().activeNodeIds, new Set(["1", "2"]));
    assert.deepEqual(store.getState().highlightedNodeIds, new Set(["1", "2"]));
    store.getState().setActiveSourceLocations("query", [{documentId: "query", from: 10, to: 20}]);
    assert.deepEqual(store.getState().highlightedNodeIds, new Set(["0"]));
    store.getState().setActiveSourceLocations("query", []);
    assert.deepEqual(store.getState().highlightedNodeIds, new Set());
    assert.deepEqual(store.getState().getLinkedSourceRanges("query"), [
        {documentId: "query", from: 10, to: 20},
        {documentId: "query", from: 12, to: 16},
    ]);
});

test("active source locations resolve hidden nodes to visible ancestors", () => {
    const root: TreeNode = {};
    const hidden: TreeNode = {sourceLocations: [{documentId: "query", from: 0, to: 5}]};
    const store = graphStore([root, hidden], new Map([["1", "0"]]), new Set(["1"]));

    store.getState().setActiveSourceLocations("query", [{documentId: "query", from: 0, to: 5}]);
    assert.deepEqual(store.getState().activeNodeIds, new Set(["1"]));
    assert.deepEqual(store.getState().highlightedNodeIds, new Set(["0"]));
    assert.deepEqual(store.getState().highlightedCollapsedSubtreeRootIds, new Set(["0"]));
    store.getState().toggleExpandedSubtree("0");
    assert.deepEqual(store.getState().highlightedNodeIds, new Set(["1"]));
    assert.deepEqual(store.getState().highlightedCollapsedSubtreeRootIds, new Set());
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
    assert.deepEqual(store.getState().highlightedNodeIds, new Set(["0"]));
    store.getState().setHoveredNodeId("1");
    assert.deepEqual(store.getState().activeNodeIds, new Set(["1"]));
    assert.deepEqual(store.getState().highlightedNodeIds, new Set(["1"]));
    assert.deepEqual(store.getState().getSourceRangesForNodes("query", store.getState().activeNodeIds), hovered.sourceLocations);
    store.getState().setHoveredNodeId(undefined);
    assert.deepEqual(store.getState().activeNodeIds, new Set(["0"]));
    assert.deepEqual(store.getState().highlightedNodeIds, new Set(["0"]));
    assert.deepEqual(store.getState().getSourceRangesForNodes("query", store.getState().activeNodeIds), node.sourceLocations);

    store.getState().setActiveSourceLocations("plan", []);
    assert.deepEqual(store.getState().highlightedNodeIds, new Set(["0"]));
    store.getState().setActiveSourceLocations("query", []);
    assert.deepEqual(store.getState().highlightedNodeIds, new Set());
});

test("malformed source ranges do not participate in highlighting", () => {
    const malformed: TreeNode = {sourceLocations: [{documentId: "query", from: 0, to: Number.NaN}]};
    const valid: TreeNode = {sourceLocations: [{documentId: "query", from: 10, to: 20}]};
    const store = graphStore([malformed, valid]);

    store.getState().setActiveSourceLocations("query", [{documentId: "query", from: 10, to: 20}]);
    assert.deepEqual(store.getState().highlightedNodeIds, new Set(["1"]));
});

test("repeated active source locations do not republish highlight state", () => {
    const node: TreeNode = {sourceLocations: [{documentId: "query", from: 0, to: 5}]};
    const store = graphStore([node]);
    let updates = 0;
    const unsubscribe = store.subscribe(() => updates++);

    const sourceLocations = [{documentId: "query", from: 0, to: 5}];
    store.getState().setActiveSourceLocations("query", sourceLocations);
    const activeNodeIds = store.getState().activeNodeIds;
    const highlightedNodeIds = store.getState().highlightedNodeIds;
    store.getState().setActiveSourceLocations("query", sourceLocations);

    assert.equal(updates, 1);
    assert.equal(store.getState().activeNodeIds, activeNodeIds);
    assert.equal(store.getState().highlightedNodeIds, highlightedNodeIds);
    unsubscribe();
});

test("documents without source locations have a stable empty snapshot", () => {
    const store = graphStore([]);

    const first = store.getState().getLinkedSourceRanges("plan");
    const second = store.getState().getLinkedSourceRanges("plan");
    assert.equal(first, second);
    assert.deepEqual(first, []);
});

test("active nodes link all of their ranges across documents", () => {
    const sharedRange = {documentId: "query", from: 0, to: 5};
    const first: TreeNode = {
        sourceLocations: [sharedRange, {documentId: "query", from: 10, to: 15}, {documentId: "plan", from: 20, to: 25}],
    };
    const second: TreeNode = {
        sourceLocations: [sharedRange, {documentId: "plan", from: 30, to: 35}],
    };
    const store = graphStore([first, second]);

    store.getState().setHoveredNodeId("0");
    assert.deepEqual(store.getState().getSourceRangesForNodes("plan", store.getState().activeNodeIds), [
        {documentId: "plan", from: 20, to: 25},
    ]);
    store.getState().setHoveredNodeId(undefined);

    store.getState().setActiveSourceLocations("query", [sharedRange]);

    assert.deepEqual(store.getState().activeNodeIds, new Set(["0", "1"]));
    assert.deepEqual(store.getState().getSourceRangesForNodes("query", store.getState().activeNodeIds), [
        sharedRange,
        {documentId: "query", from: 10, to: 15},
    ]);
    assert.deepEqual(store.getState().getSourceRangesForNodes("plan", store.getState().activeNodeIds), [
        {documentId: "plan", from: 20, to: 25},
        {documentId: "plan", from: 30, to: 35},
    ]);
});

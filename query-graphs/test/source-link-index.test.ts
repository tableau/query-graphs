import assert from "node:assert/strict";
import test from "node:test";
import type {TreeNode} from "../src/tree-description";
import {createSourceLinkIndex} from "../src/ui/source-link-index";

function sourceLinkIndex(nodes: TreeNode[]) {
    return createSourceLinkIndex(new Map(nodes.map((node, index) => [node, `${index}`])));
}

test("source ranges resolve to every linked node", () => {
    const sharedRange = {documentId: "query", from: 10, to: 20};
    const index = sourceLinkIndex([
        {sourceLocations: [sharedRange]},
        {sourceLocations: [sharedRange]},
        {sourceLocations: [{documentId: "query", from: 12, to: 16}]},
    ]);

    assert.deepEqual(index.getNodeIdsForRanges("query", [sharedRange]), new Set(["0", "1"]));
    assert.deepEqual(index.getNodeIdsForRanges("query", [{documentId: "plan", from: 10, to: 20}]), new Set());
});

test("nodes resolve to their sorted, deduplicated ranges in each document", () => {
    const sharedRange = {documentId: "query", from: 0, to: 5};
    const index = sourceLinkIndex([
        {
            sourceLocations: [{documentId: "query", from: 10, to: 15}, sharedRange, {documentId: "plan", from: 20, to: 25}],
        },
        {sourceLocations: [sharedRange, {documentId: "plan", from: 30, to: 35}]},
    ]);

    assert.deepEqual(index.getLinkedRanges("query"), [sharedRange, {documentId: "query", from: 10, to: 15}]);
    assert.deepEqual(index.getRangesForNodeIds("query", new Set(["0", "1"])), [
        sharedRange,
        {documentId: "query", from: 10, to: 15},
    ]);
    assert.deepEqual(index.getRangesForNodeIds("plan", new Set(["0", "1"])), [
        {documentId: "plan", from: 20, to: 25},
        {documentId: "plan", from: 30, to: 35},
    ]);
});

test("malformed ranges are excluded from the index", () => {
    const validRange = {documentId: "query", from: 10, to: 20};
    const index = sourceLinkIndex([
        {
            sourceLocations: [
                {documentId: "query", from: 0, to: Number.NaN},
                {documentId: "query", from: -1, to: 5},
                {documentId: "query", from: 5, to: 5},
                validRange,
            ],
        },
    ]);

    assert.deepEqual(index.getLinkedRanges("query"), [validRange]);
    assert.deepEqual(index.getNodeIdsForRanges("query", [validRange]), new Set(["0"]));
});

test("documents without source ranges share a stable empty result", () => {
    const index = sourceLinkIndex([]);

    assert.equal(index.getLinkedRanges("query"), index.getLinkedRanges("plan"));
    assert.equal(index.getRangesForNodeIds("query", new Set()), index.getRangesForNodeIds("query", new Set(["missing"])));
});

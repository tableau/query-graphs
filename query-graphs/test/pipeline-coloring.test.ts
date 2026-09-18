import assert from "node:assert/strict";
import test from "node:test";
import {assignPipelineColors} from "../src/loaders/pipeline-coloring";
import type {TreeNode} from "../src/tree-description";

test("pipeline colors follow normalized memberships across boundaries", () => {
    const scan: TreeNode = {name: "scan"};
    const join: TreeNode = {name: "join", children: [scan]};
    const sort: TreeNode = {name: "sort", children: [join]};
    const statement: TreeNode = {name: "select", children: [sort]};

    assignPipelineColors(
        statement,
        [
            {id: 6, nodes: [statement, sort]},
            {id: 5, nodes: [sort, join, scan]},
        ],
        [],
    );

    const sortColor = sort.iconColor;
    const joinColor = join.iconColor;
    assert.notEqual(sortColor, undefined);
    assert.notEqual(joinColor, undefined);
    assert.notEqual(sortColor, joinColor);

    assert.deepEqual(statement.barsBelow, [sortColor]);
    assert.deepEqual(sort.barsAbove, [sortColor]);
    assert.deepEqual(sort.edgeColors, [sortColor]);
    assert.deepEqual(sort.barsBelow, [joinColor]);
    assert.deepEqual(join.barsAbove, [joinColor]);
    assert.deepEqual(join.edgeColors, [joinColor]);
    assert.deepEqual(join.barsBelow, [joinColor]);
    assert.deepEqual(scan.barsAbove, [joinColor]);
    assert.deepEqual(scan.edgeColors, [joinColor]);
});

test("shared membership determines the pipeline at an overlapping boundary", () => {
    const child: TreeNode = {name: "child"};
    const parent: TreeNode = {name: "parent", children: [child]};

    assignPipelineColors(
        parent,
        [
            {id: 1, nodes: [child]},
            {id: 2, nodes: [parent, child]},
        ],
        [],
    );

    assert.notEqual(parent.iconColor, undefined);
    assert.deepEqual(parent.barsBelow, [parent.iconColor]);
    assert.deepEqual(child.barsAbove, [parent.iconColor]);
    assert.deepEqual(child.edgeColors, [parent.iconColor]);
});

test("disjoint memberships leave their boundary uncolored", () => {
    const child: TreeNode = {name: "child"};
    const parent: TreeNode = {name: "parent", children: [child]};

    assignPipelineColors(
        parent,
        [
            {id: 1, nodes: [parent]},
            {id: 2, nodes: [child]},
        ],
        [],
    );

    assert.equal(parent.barsBelow, undefined);
    assert.equal(child.barsAbove, undefined);
    assert.equal(child.edgeColors, undefined);
});

test("crosslink targets contribute their pipeline color before they are visited", () => {
    const source: TreeNode = {name: "source"};
    const target: TreeNode = {name: "target"};
    const root: TreeNode = {name: "root", children: [source, target]};

    assignPipelineColors(root, [{id: 1, nodes: [source, target]}], [{source, target}]);

    assert.notEqual(target.iconColor, undefined);
    assert.deepEqual(source.barsBelow, [target.iconColor]);
});

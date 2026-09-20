import assert from "node:assert/strict";
import test from "node:test";
import type {TreeNode} from "../src/tree-description";
import {findClosestVisibleAncestors, indexTreeParents} from "../src/ui/tree-index";

class CountingParents extends Map<string, string> {
    readonly lookups = new Map<string, number>();

    override get(nodeId: string): string | undefined {
        this.lookups.set(nodeId, (this.lookups.get(nodeId) ?? 0) + 1);
        return super.get(nodeId);
    }
}

test("parent indexing includes visible and collapsed children", () => {
    const visible: TreeNode = {name: "visible"};
    const collapsed: TreeNode = {name: "collapsed"};
    const root: TreeNode = {name: "root", children: [visible], collapsedChildren: [collapsed]};
    const nodeIds = new Map([
        [root, "root"],
        [visible, "visible"],
        [collapsed, "collapsed"],
    ]);

    assert.deepEqual(
        indexTreeParents({root}, nodeIds),
        new Map([
            ["collapsed", "root"],
            ["visible", "root"],
        ]),
    );
});

test("hidden nodes map to their closest visible ancestors", () => {
    const parents = new CountingParents([
        ["branch", "root"],
        ["parent", "branch"],
        ["first", "parent"],
        ["second", "parent"],
        ["detached", "missing"],
    ]);

    assert.deepEqual(
        findClosestVisibleAncestors(["first", "second", "detached"], parents, new Set(["root", "branch"])),
        new Map([
            ["first", "branch"],
            ["second", "branch"],
            ["detached", undefined],
        ]),
    );
    assert.equal(parents.lookups.get("parent"), 1, "shared ancestry should only be traversed once");
});

import assert from "node:assert/strict";
import test from "node:test";
import type {TreeNode} from "../src/tree-description";
import {createStructuralNodeVisibility, findClosestVisibleAncestors, indexTreeTopology} from "../src/ui/tree-topology";

class CountingParents extends Map<string, string> {
    readonly lookups = new Map<string, number>();

    override get(nodeId: string): string | undefined {
        this.lookups.set(nodeId, (this.lookups.get(nodeId) ?? 0) + 1);
        return super.get(nodeId);
    }
}

// The topology retains every parent edge while separately identifying children hidden by their collapsed edge.
test("tree indexing distinguishes visible and collapsed child edges", () => {
    const visible: TreeNode = {name: "visible"};
    const collapsed: TreeNode = {name: "collapsed"};
    const root: TreeNode = {name: "root", children: [visible], collapsedChildren: [collapsed]};
    const nodeIds = new Map([
        [root, "root"],
        [visible, "visible"],
        [collapsed, "collapsed"],
    ]);

    assert.deepEqual(indexTreeTopology({root}, nodeIds), {
        parents: new Map([
            ["collapsed", "root"],
            ["visible", "root"],
        ]),
        collapsedSubtreeRootIds: new Set(["collapsed"]),
    });
});

// Shared hidden paths should resolve to the closest rendered ancestor without repeatedly walking common ancestry.
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

// Each collapsed edge is controlled by its own parent, so nested subtrees become visible one expansion level at a time.
test("structural visibility follows nested collapsed-subtree expansion", () => {
    const parents = new Map([
        ["collapsed", "root"],
        ["descendant", "collapsed"],
        ["nested-collapsed", "descendant"],
        ["nested-descendant", "nested-collapsed"],
    ]);
    const collapsedSubtreeRootIds = new Set(["collapsed", "nested-collapsed"]);

    const collapsed = createStructuralNodeVisibility({}, parents, collapsedSubtreeRootIds);
    assert.equal(collapsed.has("root"), true);
    assert.equal(collapsed.has("collapsed"), false);
    assert.equal(collapsed.has("nested-descendant"), false);

    const outerExpanded = createStructuralNodeVisibility({root: true}, parents, collapsedSubtreeRootIds);
    assert.equal(outerExpanded.has("collapsed"), true);
    assert.equal(outerExpanded.has("descendant"), true);
    assert.equal(outerExpanded.has("nested-collapsed"), false);
    assert.equal(outerExpanded.has("nested-descendant"), false);

    const fullyExpanded = createStructuralNodeVisibility({root: true, descendant: true}, parents, collapsedSubtreeRootIds);
    assert.equal(fullyExpanded.has("nested-collapsed"), true);
    assert.equal(fullyExpanded.has("nested-descendant"), true);
});

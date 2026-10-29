import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import type {TreeNode} from "../../src/tree-description";
import type {CategoricalInsightCategory} from "../../src/insights/categorical";
import {createUiFixture, testGraphStore} from "./ui-test-utils";

const category = (value: string, node: TreeNode, children: CategoricalInsightCategory[] = []): CategoricalInsightCategory => ({
    value,
    nodes: [node],
    children,
});
const rows = (document: Document) => [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')];

async function renderTree(fixture: ReturnType<typeof createUiFixture>, categories: CategoricalInsightCategory[]) {
    const {CategoryTree} = await import("../../src/ui/CategoryTree");
    await fixture.render(React.createElement(CategoryTree, {title: "Example", categories}));
}

test("tree renders nested labels and occurrence counts at each level", async () => {
    const first: TreeNode = {};
    const second: TreeNode = {};
    const fixture = createUiFixture(testGraphStore([first, second]));
    try {
        await renderTree(fixture, [
            {
                value: "scan",
                nodes: [first, second],
                children: [category("native", first, [category("orders", first)]), category("external", second)],
            },
        ]);
        const tree = fixture.document.querySelector<HTMLElement>('[role="tree"]')!;
        const scan = tree.querySelector<HTMLElement>(':scope > [role="treeitem"]')!;
        // The root starts collapsed and announces the count of all descendant occurrences.
        assert.equal(tree.getAttribute("aria-label"), "Example");
        assert.equal(scan.getAttribute("aria-label"), "scan: 2");
        assert.equal(scan.getAttribute("aria-expanded"), "false");
        assert.deepEqual(
            rows(fixture.document).map((row) => row.dataset.label),
            ["scan"],
        );

        await fixture.key(scan, "ArrowRight");
        const children = [...scan.querySelectorAll<HTMLElement>(':scope > [role="group"] > [role="treeitem"]')];
        // The next level is nested under the parent, with counts for its own occurrences.
        assert.deepEqual(
            children.map((row) => [row.dataset.label, row.getAttribute("aria-label")]),
            [
                ["native", "native: 1"],
                ["external", "external: 1"],
            ],
        );
        await fixture.key(children[0], "ArrowRight");
        // A third level remains under native and has its own leaf count.
        assert.equal(
            children[0].querySelector(':scope > [role="group"] > [role="treeitem"]')?.getAttribute("aria-label"),
            "orders: 1",
        );
    } finally {
        await fixture.cleanup();
    }
});

test("tree keyboard navigation follows visible rows and reserves Enter", async () => {
    const node: TreeNode = {};
    const fixture = createUiFixture(testGraphStore([node]));
    try {
        await renderTree(fixture, [
            category("parent", node, [category("first", node), category("second", node)]),
            category("sibling", node),
        ]);
        const [parent, sibling] = rows(fixture.document);
        // Only the first visible row participates in the page's Tab order initially.
        assert.equal(parent.tabIndex, 0);
        assert.equal(sibling.tabIndex, -1);
        await React.act(async () => parent.focus());
        // Enter is reserved for future row actions; Right and Space control disclosure.
        await fixture.key(parent, "Enter");
        assert.equal(parent.getAttribute("aria-expanded"), "false");
        await fixture.key(parent, "ArrowRight");
        // Expansion inserts children into the visible navigation order.
        assert.deepEqual(
            rows(fixture.document).map((row) => row.dataset.label),
            ["parent", "first", "second", "sibling"],
        );
        const [, first, second] = rows(fixture.document);
        // Right enters an open group; vertical arrows move through its visible rows.
        await fixture.key(parent, "ArrowRight");
        assert.equal(fixture.document.activeElement, first);
        await fixture.key(first, "ArrowDown");
        assert.equal(fixture.document.activeElement, second);
        await fixture.key(second, "ArrowUp");
        assert.equal(fixture.document.activeElement, first);
        await fixture.key(first, "ArrowLeft");
        assert.equal(fixture.document.activeElement, parent);
        // Home and End target the first and last visible rows in this tree.
        await fixture.key(parent, "End");
        assert.equal(fixture.document.activeElement, sibling);
        await fixture.key(sibling, "Home");
        assert.equal(fixture.document.activeElement, parent);
        await fixture.key(parent, " ");
        assert.equal(parent.getAttribute("aria-expanded"), "false");
        // Closing hides descendants and still leaves exactly one tab stop.
        assert.deepEqual(
            rows(fixture.document).map((row) => row.dataset.label),
            ["parent", "sibling"],
        );
        assert.equal(rows(fixture.document).filter((row) => row.tabIndex === 0).length, 1);
    } finally {
        await fixture.cleanup();
    }
});

test("closing and reopening restores descendants, while new categories reset expansion", async () => {
    const node: TreeNode = {};
    const fixture = createUiFixture(testGraphStore([node]));
    const makeCategories = () => [category("parent", node, [category("child", node, [category("grandchild", node)])])];
    try {
        await renderTree(fixture, makeCategories());
        let parent = rows(fixture.document)[0];
        await fixture.key(parent, "ArrowRight");
        const child = rows(fixture.document)[1];
        await fixture.key(child, "ArrowRight");
        // Both expansion choices are active before closing the ancestor.
        assert.deepEqual(
            rows(fixture.document).map((row) => row.dataset.label),
            ["parent", "child", "grandchild"],
        );
        await fixture.key(parent, "ArrowLeft");
        // A closed ancestor hides its descendants without discarding their expansion choices.
        assert.deepEqual(
            rows(fixture.document).map((row) => row.dataset.label),
            ["parent"],
        );
        await fixture.key(parent, "ArrowRight");
        assert.deepEqual(
            rows(fixture.document).map((row) => row.dataset.label),
            ["parent", "child", "grandchild"],
        );
        // Recomputed category objects represent a new result and reset tree interaction state.
        await renderTree(fixture, makeCategories());
        parent = rows(fixture.document)[0];
        assert.equal(parent.getAttribute("aria-expanded"), "false");
        assert.equal(parent.tabIndex, 0);
    } finally {
        await fixture.cleanup();
    }
});

test("typeahead keeps a matching prefix and does not cycle on repeated letters", async () => {
    const node: TreeNode = {};
    const fixture = createUiFixture(testGraphStore([node]));
    try {
        await renderTree(fixture, [category("nation", node), category("part", node), category("partsupp", node)]);
        const [nation, part] = rows(fixture.document);
        await React.act(async () => nation.focus());
        // The first letter finds a matching visible row from the current position.
        await fixture.key(nation, "p");
        assert.equal(fixture.document.activeElement, part);
        // Extending a prefix that still matches the focused row must not jump to partsupp.
        for (const letter of "art") {
            await fixture.key(part, letter);
            assert.equal(fixture.document.activeElement, part);
        }
        await renderTree(fixture, [category("part", node), category("partsupp", node)]);
        const first = rows(fixture.document)[0];
        await React.act(async () => first.focus());
        // Repeating a letter does not cycle between matches.
        await fixture.key(first, "p");
        await fixture.key(first, "p");
        assert.equal(fixture.document.activeElement, first);
    } finally {
        await fixture.cleanup();
    }
});

test("source, pointer, and focus select only the deepest displayed category", async () => {
    const native: TreeNode = {sourceLocations: [{documentId: "query", from: 0, to: 5}]};
    const virtual: TreeNode = {sourceLocations: [{documentId: "query", from: 10, to: 15}]};
    const root: TreeNode = {children: [native], collapsedChildren: [virtual]};
    const store = testGraphStore(
        [root, native, virtual],
        new Map([
            ["1", "0"],
            ["2", "0"],
        ]),
        new Set(["2"]),
    );
    const fixture = createUiFixture(store);
    const active = () =>
        [...fixture.document.querySelectorAll<HTMLElement>(".qg-category-tree-category-active")].map(
            (row) => row.querySelector(".qg-category-tree-category-label")?.textContent,
        );
    try {
        const categories: CategoricalInsightCategory[] = [
            {
                value: "scan",
                nodes: [native, virtual],
                children: [category("native", native, [category("orders", native)]), category("virtual", virtual)],
            },
        ];
        await renderTree(fixture, categories);
        const scan = rows(fixture.document)[0];
        // Source selection picks the deepest category currently displayed for the hidden node.
        await React.act(async () => store.getState().setActiveSourceLocations("query", virtual.sourceLocations!));
        assert.deepEqual(active(), ["scan"]);
        await fixture.key(scan, "ArrowRight");
        assert.deepEqual(active(), ["virtual"]);
        const nativeRow = rows(fixture.document)[1];
        // Pointer interaction overrides the source selection, then restores it on exit.
        await React.act(async () =>
            nativeRow
                .querySelector<HTMLElement>(".qg-category-tree-category")!
                .dispatchEvent(new fixture.document.defaultView!.MouseEvent("mouseover", {bubbles: true})),
        );
        assert.deepEqual(active(), ["native"]);
        assert.deepEqual(store.getState().highlightedNodeIds, new Set(["1"]));
        await React.act(async () =>
            nativeRow
                .querySelector<HTMLElement>(".qg-category-tree-category")!
                .dispatchEvent(new fixture.document.defaultView!.MouseEvent("mouseout", {bubbles: true})),
        );
        assert.deepEqual(active(), ["virtual"]);
        await React.act(async () => store.getState().setActiveSourceLocations("query", []));
        await React.act(async () => nativeRow.focus());
        // Focus selects the exact row even when its child covers the same node IDs.
        assert.deepEqual(active(), ["native"]);
        await fixture.key(nativeRow, "ArrowRight");
        assert.deepEqual(active(), ["native"]);
        await React.act(async () => nativeRow.blur());
        await React.act(async () => store.getState().setHoveredNodeIds(new Set(["1"])));
        // Graph hover follows the deepest open level, then falls back as levels close.
        assert.deepEqual(active(), ["orders"]);
        await fixture.key(nativeRow, "ArrowLeft");
        assert.deepEqual(active(), ["native"]);
        await fixture.key(scan, "ArrowLeft");
        assert.deepEqual(active(), ["scan"]);
    } finally {
        await fixture.cleanup();
    }
});

import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import type {TreeNode} from "../src/tree-description";
import type {CategoricalInsightCategory} from "../src/insights/categorical";
import {createUiFixture, testGraphStore} from "./ui-test-utils";

const category = (value: string, node: TreeNode, children: CategoricalInsightCategory[] = []): CategoricalInsightCategory => ({
    value,
    nodes: [node],
    children,
});
const rows = (document: Document) => [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')];

async function renderTree(fixture: ReturnType<typeof createUiFixture>, categories: CategoricalInsightCategory[]) {
    const {CategoryTree} = await import("../src/ui/CategoryTree");
    await fixture.render(React.createElement(CategoryTree, {title: "Example", categories}));
}

test("tree keyboard navigation follows visible rows and reserves Enter", async () => {
    const node: TreeNode = {};
    const fixture = createUiFixture(testGraphStore([node]));
    try {
        await renderTree(fixture, [
            category("parent", node, [category("first", node), category("second", node)]),
            category("sibling", node),
        ]);
        const [parent, sibling] = rows(fixture.document);
        assert.equal(parent.tabIndex, 0);
        assert.equal(sibling.tabIndex, -1);
        await React.act(async () => parent.focus());
        await fixture.key(parent, "Enter");
        assert.equal(parent.getAttribute("aria-expanded"), "false");
        await fixture.key(parent, "ArrowRight");
        assert.deepEqual(
            rows(fixture.document).map((row) => row.dataset.label),
            ["parent", "first", "second", "sibling"],
        );
        const [, first, second] = rows(fixture.document);
        await fixture.key(parent, "ArrowRight");
        assert.equal(fixture.document.activeElement, first);
        await fixture.key(first, "ArrowDown");
        assert.equal(fixture.document.activeElement, second);
        await fixture.key(second, "ArrowUp");
        assert.equal(fixture.document.activeElement, first);
        await fixture.key(first, "ArrowLeft");
        assert.equal(fixture.document.activeElement, parent);
        await fixture.key(parent, "End");
        assert.equal(fixture.document.activeElement, sibling);
        await fixture.key(sibling, "Home");
        assert.equal(fixture.document.activeElement, parent);
        await fixture.key(parent, " ");
        assert.equal(parent.getAttribute("aria-expanded"), "false");
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
        assert.deepEqual(
            rows(fixture.document).map((row) => row.dataset.label),
            ["parent", "child", "grandchild"],
        );
        await fixture.key(parent, "ArrowLeft");
        assert.deepEqual(
            rows(fixture.document).map((row) => row.dataset.label),
            ["parent"],
        );
        await fixture.key(parent, "ArrowRight");
        assert.deepEqual(
            rows(fixture.document).map((row) => row.dataset.label),
            ["parent", "child", "grandchild"],
        );
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
        await fixture.key(nation, "p");
        assert.equal(fixture.document.activeElement, part);
        for (const letter of "art") {
            await fixture.key(part, letter);
            assert.equal(fixture.document.activeElement, part);
        }
        await renderTree(fixture, [category("part", node), category("partsupp", node)]);
        const first = rows(fixture.document)[0];
        await React.act(async () => first.focus());
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
        await React.act(async () => store.getState().setActiveSourceLocations("query", virtual.sourceLocations!));
        assert.deepEqual(active(), ["scan"]);
        await fixture.key(scan, "ArrowRight");
        assert.deepEqual(active(), ["virtual"]);
        const nativeRow = rows(fixture.document)[1];
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
        assert.deepEqual(active(), ["native"]);
        await fixture.key(nativeRow, "ArrowRight");
        assert.deepEqual(active(), ["native"]);
        await React.act(async () => nativeRow.blur());
        await React.act(async () => store.getState().setHoveredNodeIds(new Set(["1"])));
        assert.deepEqual(active(), ["orders"]);
        await fixture.key(nativeRow, "ArrowLeft");
        assert.deepEqual(active(), ["native"]);
        await fixture.key(scan, "ArrowLeft");
        assert.deepEqual(active(), ["scan"]);
    } finally {
        await fixture.cleanup();
    }
});

import assert from "node:assert/strict";
import {registerHooks} from "node:module";
import test from "node:test";
import * as React from "react";
import {createRoot} from "react-dom/client";
import {JSDOM} from "jsdom";
import type {TreeNode} from "../src/tree-description";
import {insightPresets} from "../src/insights/presets";
import {createSourceLinkIndex} from "../src/ui/source-link-index";
import {createGraphRenderingStore, GraphRenderingStoreContext} from "../src/ui/store";

registerHooks({
    load(url, context, nextLoad) {
        if (url.endsWith(".css")) return {format: "module", source: "", shortCircuit: true};
        return nextLoad(url, context);
    },
});

test("inventory rows and source highlights use the same semantic node selection", async () => {
    const {PlanInsights} = await import("../src/ui/PlanInsights");
    // Put one scan in the visible tree and one in a collapsed subtree to exercise both highlight projections.
    const native: TreeNode = {
        properties: new Map([
            ["operator", "scan"],
            ["type", "native"],
        ]),
        sourceLocations: [{documentId: "query", from: 0, to: 5}],
    };
    const virtual: TreeNode = {
        properties: new Map([
            ["operator", "scan"],
            ["type", "virtual-table"],
        ]),
        sourceLocations: [{documentId: "query", from: 10, to: 15}],
    };
    const references: TreeNode[] = Array.from({length: 3}, () => ({properties: new Map([["expression", "reference"]])}));
    const tree: TreeNode = {children: [native, ...references], collapsedChildren: [virtual]};
    const nodeIds = new Map<TreeNode, string>([
        [tree, "0"],
        [native, "1"],
        [virtual, "2"],
        ...references.map((node, index): [TreeNode, string] => [node, String(index + 3)]),
    ]);
    const store = createGraphRenderingStore({
        graphIndex: {
            nodeIds,
            treeTopology: {
                parents: new Map([
                    ["1", "0"],
                    ["2", "0"],
                    ...references.map((_, index): [string, string] => [String(index + 3), "0"]),
                ]),
                collapsedSubtreeRootIds: new Set(["2"]),
            },
            sourceLinks: createSourceLinkIndex(nodeIds),
        },
    });

    const dom = new JSDOM("<main></main>", {pretendToBeVisual: true});
    const globalNames = ["window", "document", "Node", "HTMLElement", "Event"] as const;
    const previousGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    for (const name of globalNames)
        Object.defineProperty(globalThis, name, {configurable: true, writable: true, value: dom.window[name]});
    const previousActEnvironment = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    const previousReact = Object.getOwnPropertyDescriptor(globalThis, "React");
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {configurable: true, writable: true, value: true});
    Object.defineProperty(globalThis, "React", {configurable: true, writable: true, value: React});
    const root = createRoot(dom.window.document.querySelector("main")!);

    try {
        await React.act(async () =>
            root.render(
                React.createElement(
                    GraphRenderingStoreContext.Provider,
                    {value: store},
                    React.createElement(PlanInsights, {root: tree, definitions: insightPresets.hyper}),
                ),
            ),
        );
        const panels = dom.window.document.querySelectorAll(".qg-collapsible-panel");
        assert.equal(panels.length, 1);
        const toggle = panels[0].querySelector<HTMLButtonElement>(".qg-collapsible-panel-toggle")!;
        await React.act(async () => toggle.click());
        assert.equal(toggle.ariaExpanded, "true");

        const sections = [...dom.window.document.querySelectorAll<HTMLElement>(".qg-plan-insight")];
        assert.deepEqual(
            sections.map((section) => section.querySelector("h3 button span")?.textContent),
            ["Scanned Tables", "Operators", "Expressions"],
        );
        const operatorSection = sections.find((section) => section.querySelector("h3 button span")?.textContent === "Operators")!;
        const expressionSection = sections.find(
            (section) => section.querySelector("h3 button span")?.textContent === "Expressions",
        )!;
        assert.equal(dom.window.document.querySelectorAll('[role="tree"]').length, 3);
        const operatorTree = operatorSection.querySelector<HTMLElement>('[role="tree"]')!;
        const operatorRows = () => [...operatorTree.querySelectorAll<HTMLElement>('[role="treeitem"]')];
        assert.deepEqual(
            operatorRows().map((row) => row.dataset.label),
            ["scan"],
        );
        assert.deepEqual(
            [...expressionSection.querySelectorAll<HTMLElement>('[role="treeitem"]')].map((row) => row.dataset.label),
            ["reference"],
        );
        assert.ok(!operatorRows().some((row) => row.dataset.label === "Operators"));

        const expressionHeader = expressionSection.querySelector<HTMLButtonElement>("h3 button")!;
        await React.act(async () => expressionHeader.click());
        assert.equal(expressionHeader.ariaExpanded, "false");
        assert.ok(expressionSection.querySelector<HTMLElement>(".qg-plan-insight-content")?.hidden);
        assert.ok(!operatorSection.querySelector<HTMLElement>(".qg-plan-insight-content")?.hidden);
        await React.act(async () => expressionHeader.click());
        assert.equal(expressionHeader.ariaExpanded, "true");

        const key = async (row: HTMLElement, keyName: string) =>
            React.act(async () => row.dispatchEvent(new dom.window.KeyboardEvent("keydown", {key: keyName, bubbles: true})));
        const scanRow = operatorRows()[0];
        assert.equal(scanRow.getAttribute("aria-expanded"), "false");
        await React.act(async () => scanRow.focus());
        await key(scanRow, "Enter");
        assert.equal(scanRow.getAttribute("aria-expanded"), "false");
        await key(scanRow, "ArrowRight");
        assert.equal(scanRow.getAttribute("aria-expanded"), "true");
        assert.deepEqual(
            operatorRows().map((row) => row.dataset.label),
            ["scan", "native", "virtual-table"],
        );
        assert.equal(operatorRows().filter((row) => row.tabIndex === 0).length, 1);

        let nativeRow = operatorRows()[1];
        const virtualRow = operatorRows()[2];
        const activeLabels = () =>
            [...operatorSection.querySelectorAll(".qg-category-tree-category-active .qg-category-tree-category-label")].map(
                (label) => label.textContent,
            );
        await React.act(async () => store.getState().setActiveSourceLocations("query", virtual.sourceLocations!));
        assert.deepEqual(activeLabels(), ["virtual-table"]);
        assert.ok(!dom.window.document.querySelector(".qg-panel-highlight-indicator-active"));
        const operatorHeader = operatorSection.querySelector<HTMLButtonElement>("h3 button")!;
        await React.act(async () => operatorHeader.click());
        await React.act(async () => operatorHeader.click());

        const nativeVisual = nativeRow.querySelector<HTMLElement>(".qg-category-tree-category")!;
        await React.act(async () => nativeVisual.dispatchEvent(new dom.window.MouseEvent("mouseover", {bubbles: true})));
        assert.deepEqual(store.getState().highlightedNodeIds, new Set(["1"]));
        assert.deepEqual(activeLabels(), ["native"]);
        await React.act(async () => nativeVisual.dispatchEvent(new dom.window.MouseEvent("mouseout", {bubbles: true})));
        assert.deepEqual(store.getState().highlightedNodeIds, new Set(["2"]));

        await React.act(async () => store.getState().setActiveSourceLocations("query", []));
        await React.act(async () => nativeRow.focus());
        assert.deepEqual(store.getState().highlightedNodeIds, new Set(["1"]));
        await key(nativeRow, "ArrowRight");
        assert.deepEqual(
            operatorRows().map((row) => row.dataset.label),
            ["scan", "native", "Unknown table", "virtual-table"],
        );
        await React.act(async () => operatorHeader.click());
        await React.act(async () => operatorHeader.click());
        assert.ok(operatorRows().some((row) => row.dataset.label === "Unknown table"));
        const tableRow = operatorRows()[2];
        await key(nativeRow, "ArrowRight");
        assert.equal(dom.window.document.activeElement, tableRow);
        await key(tableRow, "ArrowLeft");
        assert.equal(dom.window.document.activeElement, nativeRow);
        await key(nativeRow, "End");
        assert.equal(dom.window.document.activeElement, virtualRow);
        await key(virtualRow, "Home");
        assert.equal(dom.window.document.activeElement, scanRow);
        await key(scanRow, "v");
        assert.equal(dom.window.document.activeElement, virtualRow);

        await React.act(async () => virtualRow.blur());
        await React.act(async () => store.getState().setHoveredNodeIds(new Set(["1"])));
        assert.deepEqual(activeLabels(), ["Unknown table"]);
        await key(scanRow, "ArrowLeft");
        assert.deepEqual(activeLabels(), ["scan"]);
        await key(scanRow, "ArrowRight");
        assert.ok(operatorRows().some((row) => row.dataset.label === "Unknown table"));
        nativeRow = operatorRows().find((row) => row.dataset.label === "native")!;
        await key(nativeRow, "ArrowLeft");
        assert.deepEqual(activeLabels(), ["native"]);
        await key(scanRow, "ArrowLeft");
        assert.deepEqual(activeLabels(), ["scan"]);
    } finally {
        await React.act(async () => root.unmount());
        dom.window.close();
        if (previousActEnvironment === undefined) Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
        else Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActEnvironment);
        if (previousReact === undefined) Reflect.deleteProperty(globalThis, "React");
        else Object.defineProperty(globalThis, "React", previousReact);
        for (const [name, descriptor] of previousGlobals) {
            if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
            else Object.defineProperty(globalThis, name, descriptor);
        }
    }
});

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

test("table-name rows and source highlights use the same semantic node selection", async () => {
    const {PlanInsights} = await import("../src/ui/PlanInsights");
    // Put one scan in the visible tree and one in a collapsed subtree to exercise both highlight projections.
    const native: TreeNode = {
        properties: new Map([
            ["operator", "scan"],
            ["debug-name", '{"value":"region"}'],
        ]),
        sourceLocations: [{documentId: "query", from: 0, to: 5}],
    };
    const virtual: TreeNode = {
        properties: new Map([
            ["operator", "scan"],
            ["table-name", "warehouse"],
        ]),
        sourceLocations: [{documentId: "query", from: 10, to: 15}],
    };
    const tree: TreeNode = {children: [native], collapsedChildren: [virtual]};
    const nodeIds = new Map<TreeNode, string>([
        [tree, "0"],
        [native, "1"],
        [virtual, "2"],
    ]);
    const store = createGraphRenderingStore({
        graphIndex: {
            nodeIds,
            treeTopology: {
                parents: new Map([
                    ["1", "0"],
                    ["2", "0"],
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
                    React.createElement(PlanInsights, {
                        root: tree,
                        definitions: insightPresets.hyper.filter(({id}) => id === "table-names"),
                    }),
                ),
            ),
        );
        const toggle = dom.window.document.querySelector<HTMLButtonElement>(".qg-collapsible-panel-toggle");
        assert.ok(toggle);
        assert.equal(toggle.ariaExpanded, "false");
        await React.act(async () => toggle.click());
        assert.equal(toggle.ariaExpanded, "true");

        const treeRows = [...dom.window.document.querySelectorAll<HTMLElement>('[role="treeitem"]')];
        assert.equal(treeRows[0].getAttribute("aria-label"), "region: 1");
        assert.equal(dom.window.document.querySelector(".qg-plan-insight h3 button span")?.textContent, "Scanned Tables");
        const rows = [...dom.window.document.querySelectorAll<HTMLElement>(".qg-category-tree-category")];
        assert.equal(rows.length, 2);
        assert.deepEqual(
            rows.map((row) => row.querySelector(".qg-category-tree-category-label")?.textContent),
            ["region", "warehouse"],
        );
        await React.act(async () => treeRows[0].focus());
        await React.act(async () =>
            treeRows[0].dispatchEvent(new dom.window.KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true})),
        );
        assert.equal(dom.window.document.activeElement, treeRows[1]);
        await React.act(async () => treeRows[1].blur());

        // A linked source range activates its category even when the matching node is hidden below a collapsed root.
        await React.act(async () => store.getState().setActiveSourceLocations("query", virtual.sourceLocations!));
        assert.ok(rows[1].classList.contains("qg-category-tree-category-active"));
        assert.ok(dom.window.document.querySelector(".qg-panel-highlight-indicator-active"));

        // Pointer interaction with a category temporarily overrides the source-derived selection and restores it on exit.
        await React.act(async () => rows[0].dispatchEvent(new dom.window.MouseEvent("mouseover", {bubbles: true})));
        assert.deepEqual(store.getState().highlightedNodeIds, new Set(["1"]));
        await React.act(async () => rows[0].dispatchEvent(new dom.window.MouseEvent("mouseout", {bubbles: true})));
        assert.deepEqual(store.getState().highlightedNodeIds, new Set(["2"]));

        // Keyboard focus highlights the same nodes independently after the source-derived selection is cleared.
        await React.act(async () => store.getState().setActiveSourceLocations("query", []));
        await React.act(async () => rows[0].parentElement!.focus());
        assert.deepEqual(store.getState().highlightedNodeIds, new Set(["1"]));
        assert.deepEqual(store.getState().visibleHighlightedNodeIds, new Set(["1"]));
        assert.ok(rows[0].classList.contains("qg-category-tree-category-active"));
        await React.act(async () => rows[0].parentElement!.blur());
        assert.deepEqual(store.getState().highlightedNodeIds, new Set());
        assert.deepEqual(store.getState().visibleHighlightedNodeIds, new Set());
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

import assert from "node:assert/strict";
import {registerHooks} from "node:module";
import test from "node:test";
import * as React from "react";
import {createRoot} from "react-dom/client";
import {JSDOM} from "jsdom";

const queryGraphsSourceModules = new Map([
    ["@tableau/query-graphs/lib/ui/CollapsiblePanel", "../../query-graphs/src/ui/CollapsiblePanel.tsx"],
    ["@tableau/query-graphs/lib/ui/CopyButton", "../../query-graphs/src/ui/CopyButton.tsx"],
    ["@tableau/query-graphs/lib/ui/store", "../../query-graphs/src/ui/store.ts"],
]);

registerHooks({
    resolve(specifier, context, nextResolve) {
        const sourceModule = queryGraphsSourceModules.get(specifier);
        return sourceModule === undefined
            ? nextResolve(specifier, context)
            : nextResolve(new URL(sourceModule, import.meta.url).href, context);
    },
    load(url, context, nextLoad) {
        if (url.endsWith(".css")) return {format: "module", source: "", shortCircuit: true};
        return nextLoad(url, context);
    },
});

test("document panel titles reserve and activate their highlight indicator", async () => {
    const [{TreeLabel}, {createSourceLinkIndex}, {createGraphRenderingStore, GraphRenderingStoreContext}] = await Promise.all([
        import("../src/TreeLabel"),
        import("../../query-graphs/src/ui/source-link-index"),
        import("../../query-graphs/src/ui/store"),
    ]);
    const dom = new JSDOM("<main></main>", {pretendToBeVisual: true});
    const globalNames = ["window", "document", "Node", "HTMLElement", "MutationObserver"] as const;
    const previousGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    for (const name of globalNames)
        Object.defineProperty(globalThis, name, {configurable: true, writable: true, value: dom.window[name]});
    const previousActEnvironment = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    const previousReact = Object.getOwnPropertyDescriptor(globalThis, "React");
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {configurable: true, writable: true, value: true});
    Object.defineProperty(globalThis, "React", {configurable: true, writable: true, value: React});
    const root = createRoot(dom.window.document.querySelector("main")!);
    try {
        const sourceLocation = {documentId: "query", from: 0, to: 6};
        const node = {sourceLocations: [sourceLocation]};
        const store = createGraphRenderingStore({
            expandedSubtrees: {},
            graphIndex: {
                treeTopology: {parents: new Map(), collapsedSubtreeRootIds: new Set()},
                sourceLinks: createSourceLinkIndex(new Map([[node, "node"]])),
            },
        });
        const textDocuments = [{id: "query", title: "SQL", text: "SELECT", language: "sql"}];
        await React.act(async () =>
            root.render(
                React.createElement(
                    GraphRenderingStoreContext.Provider,
                    {value: store},
                    React.createElement(TreeLabel, {title: "Plan", textDocuments}),
                ),
            ),
        );

        const inactiveIndicator = dom.window.document.querySelector(".graph-panel-highlight-indicator");
        assert.ok(inactiveIndicator, "the indicator slot should remain mounted to keep the title width stable");
        assert.equal(inactiveIndicator.classList.contains("graph-panel-highlight-indicator-active"), false);

        await React.act(async () => store.getState().setHoveredNodeId("node"));
        const activeIndicator = dom.window.document.querySelector(".graph-panel-highlight-indicator");
        assert.ok(activeIndicator);
        assert.equal(activeIndicator.classList.contains("graph-panel-highlight-indicator-active"), true);
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

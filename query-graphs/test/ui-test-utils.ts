import {registerHooks} from "node:module";
import * as React from "react";
import {createRoot} from "react-dom/client";
import {JSDOM} from "jsdom";
import type {TreeNode} from "../src/tree-description";
import {createSourceLinkIndex} from "../src/ui/source-link-index";
import {createGraphRenderingStore, GraphRenderingStoreContext, type GraphRenderingStore} from "../src/ui/store";

// UI modules import stylesheets, which Node cannot load directly.
registerHooks({
    load(url, context, nextLoad) {
        if (url.endsWith(".css")) return {format: "module", source: "", shortCircuit: true};
        return nextLoad(url, context);
    },
});

export function testGraphStore(
    nodes: readonly TreeNode[],
    parents: ReadonlyMap<string, string> = new Map(),
    collapsedSubtreeRootIds: ReadonlySet<string> = new Set(),
): GraphRenderingStore {
    const nodeIds = new Map(nodes.map((node, index): [TreeNode, string] => [node, String(index)]));
    return createGraphRenderingStore({
        graphIndex: {
            nodeIds,
            treeTopology: {parents, collapsedSubtreeRootIds},
            sourceLinks: createSourceLinkIndex(nodeIds),
        },
    });
}

export function createUiFixture(store?: GraphRenderingStore) {
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

    return {
        document: dom.window.document,
        store,
        async render(element: React.ReactNode) {
            await React.act(async () =>
                root.render(store ? React.createElement(GraphRenderingStoreContext.Provider, {value: store}, element) : element),
            );
        },
        async key(row: HTMLElement, key: string) {
            await React.act(async () => row.dispatchEvent(new dom.window.KeyboardEvent("keydown", {key, bubbles: true})));
        },
        async cleanup() {
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
        },
    };
}

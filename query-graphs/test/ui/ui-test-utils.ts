import {registerHooks} from "node:module";
import * as React from "react";
import {createUiFixture as createBaseUiFixture} from "../../../test/ui-test-utils";
import type {TreeNode} from "../../src/tree-description";
import {createSourceLinkIndex} from "../../src/ui/source-link-index";
import {createGraphRenderingStore, GraphRenderingStoreContext, type GraphRenderingStore} from "../../src/ui/store";

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
    // Assign predictable IDs so interaction tests can assert exact highlighted node sets.
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
    const fixture = createBaseUiFixture();
    return {
        ...fixture,
        store,
        async render(element: React.ReactNode) {
            await fixture.render(
                store ? React.createElement(GraphRenderingStoreContext.Provider, {value: store}, element) : element,
            );
        },
    };
}

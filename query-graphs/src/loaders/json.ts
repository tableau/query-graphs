/*

JSON Loader
--------------------------

Render arbitrary JSON with the shared decorated-tree conversion.

*/

import type {DecoratedJsonTreeConfig} from "./decorated-json-tree";
import {convertDecoratedJsonNode, createDecoratedJsonTreeState} from "./decorated-json-tree";
import type {JsonPlanLoader} from "./types";

const namePropertyKey = "name";

const jsonTreeConfig: DecoratedJsonTreeConfig = {
    nodeTypeKeys: [namePropertyKey],
    // Generic JSON has historically shown `name` in the tooltip as well as
    // using it as the node label.
    retainNodeTypeProperty: true,
    structuralChildKeys: [],
    alwaysPropertyKeys: [],
    getRenderingConfig: () => ({}),
    shouldCollapseChild: () => false,
};

export const jsonPlanLoader: JsonPlanLoader = {
    format: "json",
    sourcePropertyKeys: new Set([namePropertyKey]),
    matches: () => true,
    load(json, context) {
        const state = createDecoratedJsonTreeState();
        const root = convertDecoratedJsonNode(json, "root", state, jsonTreeConfig, context);
        return {root};
    },
};

/*

JSON Loader
--------------------------

Render arbitrary JSON with the shared decorated-tree conversion.

*/

import type {DecoratedJsonTreeConfig} from "./decorated-json-tree";
import {convertDecoratedJsonNode, createDecoratedJsonTreeState} from "./decorated-json-tree";
import type {JsonPlanLoader} from "./types";

const jsonTreeConfig: DecoratedJsonTreeConfig = {
    nodeTypeKeys: ["name"],
    structuralChildKeys: [],
    alwaysPropertyKeys: [],
    getRenderingConfig: () => ({}),
    shouldCollapseChild: () => false,
};

export const jsonPlanLoader: JsonPlanLoader = {
    format: "json",
    sourcePropertyKeys: new Set(jsonTreeConfig.nodeTypeKeys),
    matches: () => true,
    load(json, context) {
        const state = createDecoratedJsonTreeState();
        const root = convertDecoratedJsonNode(json, "root", state, jsonTreeConfig, context);
        return {root};
    },
};

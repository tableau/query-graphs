/*

JSON Loader
--------------------------

Render arbitrary JSON with the shared decorated-tree conversion.

*/

import type {Json} from "./loader-utils";
import type {DecoratedJsonTreeConfig} from "./decorated-json-tree";
import {convertDecoratedJsonNode, createDecoratedJsonTreeState} from "./decorated-json-tree";
import type {PlanLoader} from "./types";

const jsonTreeConfig: DecoratedJsonTreeConfig = {
    getRenderingConfig: () => ({}),
    nodeTypeKeys: [],
    alwaysPropertyKeys: [],
    fixedChildOrder: [],
    shouldCollapseChild: () => false,
};

export const jsonPlanLoader: PlanLoader<Json> = {
    format: "json",
    matches: () => true,
    load(json) {
        const state = createDecoratedJsonTreeState();
        const root = convertDecoratedJsonNode(json, "root", state, jsonTreeConfig);
        return {root};
    },
};

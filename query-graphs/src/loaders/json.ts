/*

JSON Loader
--------------------------

Render arbitrary JSON with the shared decorated-tree conversion.

*/

import type {Json} from "./loader-utils";
import {hasOwnProperty, tryToString} from "./loader-utils";
import type {DecoratedJsonTreeConfig} from "./decorated-json-tree";
import {convertDecoratedJsonNode, createDecoratedJsonTreeState} from "./decorated-json-tree";
import type {PlanLoader} from "./types";

const jsonTreeConfig: DecoratedJsonTreeConfig = {
    nodeTypeKeys: [],
    structuralChildKeys: [],
    alwaysPropertyKeys: [],
    getRenderingConfig: () => ({}),
    getDisplayName(rawNode) {
        return hasOwnProperty(rawNode, "name") ? tryToString(rawNode["name"]) : undefined;
    },
    shouldCollapseChild: () => false,
};

export const jsonPlanLoader: PlanLoader<Json> = {
    format: "json",
    matches: () => true,
    load(json, context) {
        const state = createDecoratedJsonTreeState();
        const root = convertDecoratedJsonNode(json, "root", state, jsonTreeConfig, context);
        return {root};
    },
};

/*

JSON Loader
--------------------------

Render arbitrary JSON with the shared decorated-tree conversion.

*/

import {hasOwnProperty, tryToString} from "./loader-utils";
import type {DecoratedJsonTreeConfig} from "./decorated-json-tree";
import {convertDecoratedJsonNode, createDecoratedJsonTreeState} from "./decorated-json-tree";
import type {JsonPlanLoader} from "./types";

const namePropertyKey = "name";

const jsonTreeConfig: DecoratedJsonTreeConfig = {
    nodeTypeKeys: [],
    structuralChildKeys: [],
    alwaysPropertyKeys: [],
    getRenderingConfig: () => ({}),
    getDisplayName(rawNode) {
        return hasOwnProperty(rawNode, namePropertyKey) ? tryToString(rawNode[namePropertyKey]) : undefined;
    },
    getSourcePropertyKey(rawNode) {
        return hasOwnProperty(rawNode, namePropertyKey) && tryToString(rawNode[namePropertyKey]) !== undefined
            ? namePropertyKey
            : undefined;
    },
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

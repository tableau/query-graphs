/*

JSON Loader
--------------------------

Map the JSON tree directly to a D3 tree, without any modifications

*/

import * as common from "./common";
import {TreeDescription} from "./tree-description";

function convertChildren(node) {
    let children;
    if (common.toString(node) !== undefined) {
        return [
            {
                name: common.toString(node) + ":" + typeof node,
                properties: {
                    value: common.toString(node),
                    type: typeof node,
                },
            },
        ];
    } else if (typeof node === "object" && !Array.isArray(node)) {
        // "Object" nodes
        children = [];
        Object.getOwnPropertyNames(node)
            .sort()
            .forEach(function(key) {
                children.push({name: key, children: convertChildren(node[key])});
            });
        return children;
    } else if (Array.isArray(node)) {
        // "Array" nodes
        children = [];
        node.forEach(function(value, index) {
            children.push({
                name: String(index),
                children: convertChildren(node[index]),
            });
        });
        return children;
    }
    console.warn("Unhandled JSON type");
    return [{name: JSON.stringify(node)}];
}

// Load a JSON tree
export function loadJson(json): TreeDescription {
    const root = {name: "root", children: convertChildren(json)};
    return {root: root};
}

// Load a JSON tree from text
export function loadJsonFromText(graphString: string, _graphCollapse): TreeDescription {
    let json;
    try {
        json = JSON.parse(graphString);
    } catch (err) {
        throw new Error("JSON parse failed with '" + err + "'.");
    }
    return loadJson(json);
}

/*

JSON Loader
--------------------------

Map the JSON tree directly to a D3 tree, without any modifications

*/

import * as common from './common';

function convertChildren(node) {
    var children;
    if (common.toString(node) !== undefined) {
        return [{
            name: common.toString(node) + ":" + typeof node,
            properties: {
                value: common.toString(node),
                type: typeof node
            }
        }];
    } else if (typeof (node) === "object" && !Array.isArray(node)) {
        // "Object" nodes
        children = [];
        Object.getOwnPropertyNames(node).sort().forEach(function(key) {
            children.push({name: key, children: convertChildren(node[key])});
        });
        return children;
    } else if (Array.isArray(node)) {
        // "Array" nodes
        children = [];
        node.forEach(function(value, index) {
            children.push({name: String(index), children: convertChildren(node[index])});
        });
        return children;
    }
    console.warn("Unhandled JSON type");
    return [{name: JSON.stringify(node)}];
}

// Load a JSON tree
export function loadJson(graphString, _graphCollapse) {
    var json;
    try {
        json = JSON.parse(graphString);
    } catch (err) {
        return {error: "JSON parse failed with '" + err + "'."};
    }
    var root = {name: "root", children: convertChildren(json)};
    return {root: root};
}

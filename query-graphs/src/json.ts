/*

JSON Loader
--------------------------

Map the JSON tree directly to a D3 tree, without any modifications

*/

import {Json, tryToString} from "./loader-utils";
import {TreeDescription, TreeNode} from "./tree-description";

function convertChildren(node: Json): TreeNode[] {
    const strRep = tryToString(node);
    if (strRep !== undefined) {
        return [
            {
                name: strRep + ":" + typeof node,
                properties: new Map([
                    ["value", strRep],
                    ["type", typeof node],
                ]),
            },
        ];
    } else if (typeof node === "object" && !Array.isArray(node) && node !== null) {
        // "Object" nodes
        const children = [] as TreeNode[];
        const propNames = Object.getOwnPropertyNames(node).sort();
        for (const key of propNames) {
            children.push({name: key, children: convertChildren(node[key])});
        }
        return children;
    } else if (Array.isArray(node)) {
        // "Array" nodes
        const children = [] as TreeNode[];
        for (let index = 0; index < node.length; ++index) {
            children.push({
                name: index.toString(),
                children: convertChildren(node[index]),
            });
        }
        return children;
    }
    console.warn("Unhandled JSON type");
    return [{name: JSON.stringify(node)}];
}

// Load a JSON tree
export function loadJson(json: Json): TreeDescription {
    const root = {name: "root", children: convertChildren(json)};
    return {root: root};
}

// Load a JSON tree from text
export function loadJsonFromText(graphString: string): TreeDescription {
    let json: Json;
    try {
        json = JSON.parse(graphString);
    } catch (err) {
        throw new Error("JSON parse failed with '" + err + "'.");
    }
    return loadJson(json);
}

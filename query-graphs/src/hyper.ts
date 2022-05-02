/*

Hyper JSON Transformations
--------------------------

The Hyper JSON representation renders verbosely as a D3 tree; therefore, perform the following transformations.

Render a few pre-defined keys ("left", "right", "input" and a few others) always as direct input nodes.
For most other nodes, decide based on their value: if it is of a plain type (string, number, ...), show it as part
of the tooltip; otherwise show it as part of the tree.
A short list of special-cased keys (e.g., "analyze") is always displayed as part of the tooltip.
The label for a tree node is taken from the first defined property among "operator", "expression" and "mode".

*/

import * as treeDescription from "./tree-description";
import {TreeNode, TreeDescription, Crosslink} from "./tree-description";
import {Json, forceToString, tryToString, formatMetric, hasOwnProperty} from "./loader-utils";

// Convert Hyper JSON to a D3 tree
function convertHyperNode(node: Json, parentKey = "result"): TreeNode | TreeNode[] {
    if (tryToString(node) !== undefined) {
        return {
            text: tryToString(node),
        };
    } else if (typeof node === "object" && !Array.isArray(node) && node !== null) {
        // "Object" nodes
        let explicitChildren = [] as TreeNode[];
        const additionalChildren = [] as TreeNode[];
        const properties = new Map<string, string>();

        // Take the first present tagKey as the new tag. Add all others as properties
        const tagKeys = ["operator", "expression", "mode"];
        let tag: string | undefined;
        for (const tagKey of tagKeys) {
            if (!node.hasOwnProperty(tagKey)) {
                continue;
            }
            if (tag === undefined) {
                tag = tryToString(node[tagKey]);
            } else {
                properties.set(tagKey, forceToString(node[tagKey]));
            }
        }
        if (tag === undefined) {
            tag = parentKey;
        }

        // Add the following keys as children
        const childKeys = ["input", "left", "right", "arguments", "value", "valueForComparison"];
        for (const key of childKeys) {
            if (!node.hasOwnProperty(key)) {
                continue;
            }
            const child = convertHyperNode(node[key], key);
            if (Array.isArray(child)) {
                explicitChildren = explicitChildren.concat(child);
            } else {
                explicitChildren.push(child);
            }
        }

        // Display these properties always as properties, even if they are more complex
        const propertyKeys = ["analyze", "querylocs"];
        for (const key of propertyKeys) {
            if (!node.hasOwnProperty(key)) {
                continue;
            }
            properties.set(key, forceToString(node[key]));
        }

        // Display all other properties adaptively: simple expressions are displayed as properties, all others as part of the tree
        const handledKeys = tagKeys.concat(childKeys, propertyKeys);
        for (const key of Object.getOwnPropertyNames(node)) {
            if (handledKeys.indexOf(key) !== -1) {
                continue;
            }

            // Try to display as string property
            const str = tryToString(node[key]);
            if (str !== undefined) {
                properties.set(key, str);
                continue;
            }

            // Display as part of the tree
            const innerNodes = convertHyperNode(node[key], key);
            if (Array.isArray(innerNodes)) {
                additionalChildren.push({tag: key, children: innerNodes});
            } else {
                additionalChildren.push({tag: key, children: [innerNodes]});
            }
        }

        // Display the cardinality on the links between the nodes
        let edgeLabel: string | undefined = undefined;
        if (hasOwnProperty(node, "cardinality") && typeof node.cardinality === "number") {
            edgeLabel = formatMetric(node.cardinality);
        }
        // Collapse nodes as appropriate
        let children: TreeNode[];
        let _children: TreeNode[];
        if (node.hasOwnProperty("plan")) {
            // The top-level plan element needs special attention: we want to hide the `header` by default
            _children = explicitChildren.concat(additionalChildren);
            const planIdx = _children.findIndex(n => {
                return n.tag === "plan";
            });
            children = [_children[planIdx]];
        } else if (node.hasOwnProperty("operator")) {
            // For operators, the additionalChildren are collapsed by default
            children = explicitChildren;
            _children = explicitChildren.concat(additionalChildren);
        } else {
            // Everything else (usually expressions): display uncollapsed
            children = explicitChildren.concat(additionalChildren);
            _children = [];
        }
        // Build the converted node
        const convertedNode = {
            tag: tag,
            properties: properties,
            children: children,
            _children: _children,
            edgeLabel: edgeLabel,
        };
        return convertedNode;
    } else if (Array.isArray(node)) {
        // "Array" nodes
        const listOfObjects = [] as TreeNode[];
        for (let index = 0; index < node.length; ++index) {
            const value = node[index];
            const innerNode = convertHyperNode(value, parentKey + "." + index.toString());
            // objectify nested arrays
            if (Array.isArray(innerNode)) {
                innerNode.forEach(value => {
                    listOfObjects.push(value);
                });
            } else {
                listOfObjects.push(innerNode);
            }
        }
        return listOfObjects;
    }
    throw new Error("Invalid Hyper query plan");
}

// Function to generate nodes' display names based on their properties
function generateDisplayNames(treeRoot: TreeNode) {
    treeDescription.visitTreeNodes(
        treeRoot,
        node => {
            node.name =
                node.name ?? node.properties?.get("name") ?? node.properties?.get("debugName") ?? node.tag ?? node.text ?? "";
            switch (node.tag) {
                case "executiontarget":
                    node.symbol = "run-query-symbol";
                    break;
                case "join":
                    node.symbol = "inner-join-symbol";
                    break;
                case "leftouterjoin":
                    node.symbol = "left-join-symbol";
                    break;
                case "rightouterjoin":
                    node.symbol = "right-join-symbol";
                    break;
                case "fullouterjoin":
                    node.symbol = "full-join-symbol";
                    break;
                case "tablescan":
                    node.symbol = "table-symbol";
                    break;
                case "virtualtable":
                    node.name = node.properties?.get("name") ?? node.tag;
                    node.symbol = "virtual-table-symbol";
                    break;
                case "tableconstruction":
                    node.symbol = "const-table-symbol";
                    break;
                case "binaryscan":
                case "cursorscan":
                case "csvscan":
                case "parquetscan":
                case "tdescan":
                    node.symbol = "table-symbol";
                    break;
                case "select":
                case "earlyprobe":
                    node.symbol = "filter-symbol";
                    break;
                case "sort":
                    node.symbol = "sort-symbol";
                    break;
                case "explicitscan":
                    node.symbol = "temp-table-symbol";
                    break;
                case "temp":
                    node.symbol = "temp-table-symbol";
                    node.edgeClass = "qg-link-and-arrow";
                    break;
                case "comparison":
                    node.name = node.properties?.get("mode") ?? node.name;
                    break;
                case "iuref":
                    node.name = node.properties?.get("iu") ?? node.name;
                    break;
                case "attribute":
                case "condition":
                case "iu":
                case "name":
                case "operation":
                case "source":
                case "tableOid":
                case "tid":
                case "tupleFlags":
                case "output":
                    if (node.text) {
                        node.name = node.tag + ":" + node.text;
                    } else {
                        node.name = node.tag;
                    }
                    break;
            }
        },
        treeDescription.allChildren,
    );
}

// Function to add crosslinks between related nodes
function addCrosslinks(root: TreeNode) {
    interface UnresolvedCrosslink {
        source: TreeNode;
        targetOpId: number;
    }

    const unresolvedLinks = [] as UnresolvedCrosslink[];
    const operatorsById = new Map<number, TreeNode>();

    treeDescription.visitTreeNodes(
        root,
        node => {
            // Build map from operatorId to node
            const operatorId = node.properties?.get("operatorId");
            if (operatorId !== undefined) {
                const key = parseInt(operatorId, 10);
                operatorsById.set(key, node);
            }

            // Identify source operators
            let sourceKey: string;
            switch (node.tag) {
                case "explicitscan":
                    sourceKey = "source";
                    break;
                case "earlyprobe":
                    sourceKey = "builder";
                    break;
                default:
                    sourceKey = "magic";
                    break;
            }
            if (sourceKey !== undefined) {
                const sourceId = node.properties?.get(sourceKey);
                if (sourceId !== undefined) {
                    unresolvedLinks.push({
                        source: node,
                        targetOpId: parseInt(sourceId, 10),
                    });
                }
            }
        },
        treeDescription.allChildren,
    );

    // Add crosslinks from source to matching target node
    const crosslinks = [] as Crosslink[];
    for (const link of unresolvedLinks) {
        const target = operatorsById.get(link.targetOpId);
        if (target !== undefined) {
            crosslinks.push({source: link.source, target: target});
        }
    }
    return crosslinks;
}

interface LinkedNodes {
    root: TreeNode;
    crosslinks: Crosslink[];
}

function convertHyperPlan(node: Json): LinkedNodes {
    const root = convertHyperNode(node);
    if (Array.isArray(root)) {
        throw new Error("Invalid Hyper query plan");
    }
    generateDisplayNames(root);
    const crosslinks = addCrosslinks(root);
    return {root, crosslinks};
}

function convertOptimizerSteps(node: Json): LinkedNodes | undefined {
    // Check if we have a top-level object with a single key "optimizersteps" containing an array
    if (typeof node !== "object" || Array.isArray(node) || node === null) return undefined;
    if (Object.getOwnPropertyNames(node).length != 1) return undefined;
    if (!node.hasOwnProperty("optimizersteps")) return undefined;
    const steps = node["optimizersteps"];
    if (!Array.isArray(steps)) return undefined;

    // Transform the optimizer steps
    const crosslinks: Crosslink[] = [];
    const children: TreeNode[] = [];
    for (let i = 0; i < steps.length; ++i) {
        const step = steps[i];
        // Check that our step has two subproperties: "name" and "plan"
        if (typeof step !== "object" || Array.isArray(step) || step === null) return undefined;
        if (Object.getOwnPropertyNames(step).length != 2) return undefined;
        if (!step.hasOwnProperty("name")) return undefined;
        if (!step.hasOwnProperty("plan")) return undefined;
        const name = step["name"];
        const plan = step["plan"];
        if (typeof name !== "string") return undefined;

        // Add the child
        const {root: childRoot, crosslinks: newCrosslinks} = convertHyperPlan(plan);
        crosslinks.push(...newCrosslinks);
        children.push({name: name, children: [childRoot]});
    }
    const root = {name: "optimizersteps", children: children};
    return {root, crosslinks};
}

// Loads a Hyper query plan
export function loadHyperPlan(json: Json, graphCollapse?: unknown): TreeDescription {
    // Load the graph with the nodes collapsed in an automatic way
    const {root, crosslinks} = convertOptimizerSteps(json) ?? convertHyperPlan(json);
    treeDescription.createParentLinks(root);
    // Adjust the graph so it is collapsed as requested by the user
    if (graphCollapse === "y") {
        treeDescription.visitTreeNodes(root, treeDescription.collapseAllChildren, treeDescription.allChildren);
    } else if (graphCollapse === "n") {
        treeDescription.visitTreeNodes(root, treeDescription.expandAllChildren, treeDescription.allChildren);
    }
    return {root, crosslinks};
}

// Load a JSON tree from text
export function loadHyperPlanFromText(graphString: string, graphCollapse?: unknown): TreeDescription {
    // Parse the plan as JSON
    let json: Json;
    try {
        json = JSON.parse(graphString);
    } catch (err) {
        throw new Error("JSON parse failed with '" + err + "'.");
    }
    return loadHyperPlan(json, graphCollapse);
}

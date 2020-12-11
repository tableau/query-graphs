/*

Tableau query plans (e.g., logical queries)
--------------------------

Tableau's query plans are stored as XML. We first load that XML using xml2js
and convert it literally into a query tree using `convertJSON`. The XML
already provides us the structure of the rendered tree.

*/

// Require node modules
import * as treeDescription from "./tree-description";
import {TreeDescription, TreeNode, Crosslink, collapseAllChildren, streamline} from "./tree-description";
import {typesafeXMLParse, ParsedXML} from "./xml";
import {assert} from "./loader-utils";

// Convert JSON as returned by xml2js parser to d3 tree format
function convertXML(xml: ParsedXML) {
    const children = [] as any[];
    const properties = new Map<string, string>();
    let text: string | undefined;
    const tag = xml["#name"];

    if (xml.$) {
        for (const key of Object.getOwnPropertyNames(xml.$)) {
            properties.set(key, xml.$[key]);
        }
    }
    if (xml._) {
        text = xml._;
    }
    if (xml.$$) {
        for (const child of xml.$$) {
            children.push(convertXML(child));
        }
    }

    return {
        tag: tag,
        properties: properties,
        text: text,
        children: children,
    };
}

// Function to generate nodes' display names based on their properties
const generateDisplayNames = (function() {
    // Get the first non-null, non-empty string
    function fallback(...args: (string | undefined)[]) {
        for (const arg of args) {
            if (arg !== undefined && arg.length !== 0) {
                return arg;
            }
        }
    }

    // Function to eliminate node
    function eliminateNode(node: TreeNode) {
        const parent = node.parent;
        if (!parent) {
            return;
        }
        assert(parent.children !== undefined);
        let nodeIndex = parent.children.indexOf(node);
        parent.children.splice(nodeIndex, 1);
        if (node.children) {
            for (let i = 0; i < node.children.length; i++) {
                node.children[i].parent = parent;
                parent.children.splice(nodeIndex++, 0, node.children[i]);
            }
        }
    }

    // properties.class are the expressions
    function handleLogicalExpression(node: TreeNode) {
        const clazz = node.properties?.get("class");
        switch (clazz) {
            case "identifier":
                node.name = node.text;
                node.class = "identifier";
                break;
            case "funcall":
                node.name = node.properties?.get("function");
                node.class = "function";
                break;
            case "literal":
                node.name = node.properties?.get("datatype") + ":" + node.text;
                break;
            default:
                node.name = clazz;
                break;
        }
    }

    // tags are the expressions
    function handleLogicalExpression2(node: TreeNode) {
        switch (node.tag) {
            case "identifierExp":
                node.name = node.properties?.get("identifier");
                node.class = "identifier";
                break;
            case "funcallExp":
                node.name = node.properties?.get("function");
                node.class = "function";
                break;
            case "literalExp":
                node.name = node.properties?.get("datatype") + ":" + node.properties?.get("value");
                break;
            case "referenceExp":
                node.name = "ref:" + node.properties?.get("ref");
                node.class = "reference";
                break;
            default:
                node.name = node.tag?.replace(/Exp$/, "");
                break;
        }
    }

    function handleQueryExpression(node: TreeNode) {
        const clazz = node.properties?.get("class");
        switch (clazz) {
            case "identifier":
                node.name = node.text;
                node.class = "identifier";
                break;
            case "funcall":
                node.name = node.properties?.get("function");
                node.class = "function";
                break;
            case "literal":
                node.name = node.properties?.get("datatype") + ":" + node.text;
                break;
            default:
                node.name = clazz;
                break;
        }
    }

    function handleQueryFunction(node: TreeNode) {
        const clazz = node.properties?.get("class");
        switch (clazz) {
            case "table":
                node.name = node.properties?.get("table");
                node.class = "relation";
                break;
            default:
                node.name = clazz;
                break;
        }
    }

    // properties.class are the operators
    function handleLogicalOperator(node: TreeNode) {
        const clazz = node.properties?.get("class");
        switch (clazz) {
            case "join":
                node.name = node.properties?.get("name");
                node.class = "join";
                break;
            case "relation":
                node.name = node.properties?.get("name");
                node.class = "relation";
                break;
            case "tuples": {
                const alias = node.properties?.get("alias");
                if (alias) {
                    node.name = clazz + ":" + alias;
                } else {
                    node.name = clazz;
                }
                break;
            }
            default:
                node.name = clazz;
                break;
        }
    }

    // tags are the operators
    function handleLogicalOperator2(node: TreeNode) {
        switch (node.tag) {
            case "joinOp":
                node.name = node.tag.replace(/Op$/, "");
                node.class = "join";
                break;
            case "referenceOp":
                node.name = "ref:" + node.properties?.get("ref");
                node.class = "reference";
                break;
            case "relationOp":
                node.name = node.properties?.get("name");
                node.class = "relation";
                break;
            case "tuplesOp": {
                const alias = node.properties?.get("alias");
                if (alias) {
                    node.name = node.tag.replace(/Op$/, "") + ":" + alias;
                } else {
                    node.name = node.tag.replace(/Op$/, "");
                }
                break;
            }
            default:
                node.name = node.tag?.replace(/Op$/, "");
                break;
        }
    }

    // properties.class are the operators
    function handleFedOp(node: TreeNode) {
        const clazz = node.properties?.get("class");
        switch (clazz) {
            case "createtemptable":
            case "createtemptablefromquery":
            case "createtemptablefromtuples":
                node.name = fallback(node.properties?.get("table"), clazz);
                node.class = "createtemptable";
                break;
            default:
                node.name = clazz;
                break;
        }
    }

    // extensions for calculation-language expression trees
    function handleExpression(node: TreeNode) {
        if (node.text) {
            node.name = node.text;
        } else if (node.properties?.has("name")) {
            node.name = node.properties.get("name");
        } else if (node.properties?.has("value")) {
            node.name = node.properties.get("value");
            if (node.properties.get("type") === "string") {
                node.name = "'" + node.name + "'";
            }
        } else if (node.properties?.has("class")) {
            node.name = node.properties.get("class");
        } else {
            eliminateNode(node);
        }
    }

    function generateDisplayNames(node: TreeNode) {
        // In-order traversal. Leaf node don't have children
        if (node.children !== undefined) {
            for (let i = 0; i < node.children.length; i++) {
                generateDisplayNames(node.children[i]);
            }
        }
        switch (node.tag) {
            case "table-parameters":
                eliminateNode(node);
                break;
            case "arguments":
                eliminateNode(node);
                break;
            case "logical-expression":
                handleLogicalExpression(node);
                break;
            case "query-expression":
                handleQueryExpression(node);
                break;
            case "query-function":
                handleQueryFunction(node);
                break;
            case "fed-op":
                handleFedOp(node);
                break;
            case "logical-operator":
                handleLogicalOperator(node);
                break;
            case "calculation":
                node.name = node.properties?.get("formula");
                break;
            case "condition":
                node.name = fallback(node.properties?.get("op"), node.tag);
                break;
            case "field":
                node.name = fallback(node.text, node.properties?.get("name"), "field{}");
                break;
            case "binding":
                node.name = fallback(node.properties?.get("name"), node.properties?.get("ref"), node.tag);
                break;
            case "relation":
                node.name = fallback(node.properties?.get("name"), node.tag);
                node.class = "relation";
                break;
            case "column":
            case "runquery-column":
                node.name = fallback(node.properties?.get("name"), node.tag);
                break;
            case "dimensions":
                node.name = fallback(node.text, node.properties?.get("type"), node.tag);
                break;
            case "expression":
                handleExpression(node);
                break;
            case "tuple":
            case "value":
                node.name = fallback(node.text, node.tag);
                break;
            case "attribute":
            case "table":
            case "type":
                if (node.text) {
                    node.name = node.tag + ":" + node.text;
                } else if (node.properties?.get("name")) {
                    node.name = node.tag + ":" + node.properties.get("name");
                } else {
                    node.name = node.tag;
                }
                break;
            case "function":
            case "identifier":
                fallback(node.properties?.get("name"), node.tag);
                break;
            case "literal":
                node.name = node.properties?.get("type") + ":" + node.properties?.get("value");
                break;
            default:
                switch (node.properties?.get("class")) {
                    case "logical-expression":
                        handleLogicalExpression2(node);
                        break;
                    case "logical-operator":
                        handleLogicalOperator2(node);
                        break;
                    default:
                        if (node.tag) {
                            node.name = node.tag;
                        } else {
                            node.name = JSON.stringify(node);
                        }
                        break;
                }
                break;
        }
    }

    return generateDisplayNames;
})();

// Assign symbols & classes to the nodes
function assignSymbolsAndClasses(root: TreeNode) {
    treeDescription.visitTreeNodes(
        root,
        (n: TreeNode) => {
            // Assign symbols
            if (n.class === "join" && n.properties?.has("join")) {
                n.symbol = n.properties.get("join") + "-join-symbol";
            } else if (n.tag === "join-inner") {
                n.symbol = "inner-join-symbol";
            } else if (n.tag === "join-left") {
                n.symbol = "left-join-symbol";
            } else if (n.tag === "join-right") {
                n.symbol = "right-join-symbol";
            } else if (n.tag === "join-full") {
                n.symbol = "full-join-symbol";
            } else if (n.class && n.class === "relation") {
                n.symbol = "table-symbol";
            } else if (n.class && n.class === "createtemptable") {
                n.symbol = "temp-table-symbol";
            } else if (n.tag == "selectOp") {
                n.symbol = "filter-symbol";
            } else if (n.name && n.name === "runquery") {
                n.symbol = "run-query-symbol";
            }
            // Assign classes for incoming edge
            if (n.tag === "binding" || n.class === "createtemptable" || (n.tag === "expression" && n.properties?.has("name"))) {
                assert(n.children !== undefined);
                n.children.forEach(c => {
                    c.edgeClass = "qg-link-and-arrow";
                });
            } else if (n.name === "runquery") {
                assert(n.children !== undefined);
                n.children.forEach(c => {
                    if (c.class === "createtemptable") {
                        c.edgeClass = "qg-dotted-link";
                    }
                });
            }
        },
        treeDescription.allChildren,
    );
}

function collapseNodes(root: TreeNode, graphCollapse?: unknown) {
    const streamlineOrCollapse = graphCollapse === "s" ? streamline : collapseAllChildren;
    if (graphCollapse !== "n") {
        treeDescription.visitTreeNodes(
            root,
            d => {
                switch (d.name) {
                    case "condition":
                    case "conditions":
                    case "datasource":
                    case "expressions":
                    case "field":
                    case "groupbys":
                    case "group-bys":
                    case "imports":
                    case "measures":
                    case "column-names":
                    case "replaced-columns":
                    case "renamed-columns":
                    case "new-columns":
                    case "metadata-record":
                    case "metadata-records":
                    case "orderbys":
                    case "order-bys":
                    case "filter":
                    case "predicate":
                    case "restrictions":
                    case "runquery-columns":
                    case "selects":
                    case "schema":
                    case "tid":
                    case "top":
                    case "aggregates":
                    case "join-conditions":
                    case "join-condition":
                    case "arguments":
                    case "function-node":
                    case "type":
                    case "tuples":
                        streamlineOrCollapse(d);
                        return;
                }
                switch (d.class) {
                    case "relation":
                        collapseAllChildren(d);
                        return;
                }
            },
            function(d): TreeNode[] {
                return d.children && d.children.length > 0 ? d.children.slice(0) : [];
            },
        );
    }
}

function getFederationConnectionType(node: TreeNode) {
    const connection = node.properties?.get("connection");
    return connection ? connection.split(".")[0] : undefined;
}

// Color graph per federated connections
function colorFederated(node: TreeNode, federatedType?: string) {
    if (node.tag === "fed-op") {
        federatedType = getFederationConnectionType(node) ?? federatedType;
    }
    if (federatedType !== undefined) {
        node.nodeClass = "qg-" + federatedType;
    }
    for (const child of treeDescription.allChildren(node)) {
        colorFederated(child, federatedType);
    }
}

// Prepare the loaded data for visualization
function prepareTreeData(xml: ParsedXML, graphCollapse?: unknown): TreeNode {
    const treeData = convertXML(xml);
    // Tag the tree root
    if (!treeData.tag) {
        treeData.tag = "result";
    }
    treeDescription.createParentLinks(treeData);
    generateDisplayNames(treeData);
    assignSymbolsAndClasses(treeData);

    colorFederated(treeData);
    collapseNodes(treeData, graphCollapse);
    return treeData;
}

// Function to add crosslinks between related nodes
function addCrosslinks(root: TreeNode): Crosslink[] {
    interface UnresolvedCrosslink {
        source: TreeNode;
        targetName: string;
    }

    const unresolvedLinks: UnresolvedCrosslink[] = [];
    const operatorsByName = new Map<string, TreeNode>();

    treeDescription.visitTreeNodes(
        root,
        node => {
            // Build map from potential target operator name/ref to node
            const ref = node.properties?.get("ref");
            if (getFederationConnectionType(node) === "fedeval_dataengine_connection" && node.class === "relation" && node.name) {
                operatorsByName.set(node.name, node);
            } else if (node.tag === "binding" && ref !== undefined) {
                operatorsByName.set("ref", node);
            }

            // Identify source operators
            switch (node.tag) {
                case "fed-op": {
                    const table = node.properties?.get("table");
                    if (node.properties?.get("class") === "createtemptable" && table !== undefined) {
                        unresolvedLinks.push({source: node, targetName: table});
                    }
                    break;
                }
                case "referenceOp":
                case "referenceExp": {
                    const ref = node.properties?.get("ref");
                    if (ref !== undefined) {
                        unresolvedLinks.push({source: node, targetName: ref});
                    }
                    break;
                }
                default:
                    break;
            }
        },
        treeDescription.allChildren,
    );

    // Add crosslinks from source to matching target node
    const crosslinks = [] as Crosslink[];
    for (const link of unresolvedLinks) {
        const target = operatorsByName.get(link.targetName);
        if (target !== undefined) {
            crosslinks.push({source: link.source, target: target});
        }
    }

    return crosslinks;
}

export function loadTableauPlan(graphString: string, graphCollapse?: unknown): TreeDescription {
    const xml = typesafeXMLParse(graphString);
    const root = prepareTreeData(xml, graphCollapse);
    const crosslinks = addCrosslinks(root);
    return {root: root, crosslinks: crosslinks};
}

/*

Tableau query plans (e.g., logical queries)
--------------------------

Tableau's query plans are stored as XML. We first load that XML using xml2js
and convert it literally into a query tree using `convertJSON`. The XML
already provides us the structure of the rendered tree.

*/

// Require node modules
var common = require('./common');
var colors = require('./colors');
var xml2js = require('xml2js');

// Convert JSON as returned by xml2js parser to d3 tree format
function convertJSON(node) {
    var children = [];
    var properties = {};
    var text;
    var tag = node["#name"];

    if (node.$) {
        properties = node.$;
    }
    if (node._) {
        text = node._;
    }
    if (node.$$) {
        node.$$.forEach(function(child) {
            children.push(convertJSON(child));
        });
    }

    return {
        tag: tag,
        properties: properties,
        text: text,
        children: children
    };
}

// Function to generate nodes' display names based on their properties
var generateDisplayNames = (function() {
    // properties.class are the expressions
    function handleLogicalExpression(node) {
        switch (node.properties.class) {
            case "identifier":
                node.name = node.text;
                node.class = "identifier";
                break;
            case "funcall":
                node.name = node.properties.function;
                node.class = "function";
                break;
            case "literal":
                node.name = node.properties.datatype + ":" + node.text;
                break;
            default:
                node.name = node.properties.class;
                break;
        }
    }

    // tags are the expressions
    function handleLogicalExpression2(node) {
        switch (node.tag) {
            case "identifierExp":
                node.name = node.properties.identifier;
                node.class = "identifier";
                break;
            case "funcallExp":
                node.name = node.properties.function;
                node.class = "function";
                break;
            case "literalExp":
                node.name = node.properties.datatype + ":" + node.properties.value;
                break;
            case "referenceExp":
                node.name = "ref:" + node.properties.ref;
                node.class = "reference";
                break;
            default:
                node.name = node.tag.replace(/Exp$/, '');
                break;
        }
    }

    function handleQueryExpression(node) {
        switch (node.properties.class) {
            case "identifier":
                node.name = node.text;
                node.class = "identifier";
                break;
            case "funcall":
                node.name = node.properties.function;
                node.class = "function";
                break;
            case "literal":
                node.name = node.properties.datatype + ":" + node.text;
                break;
            default:
                node.name = node.properties.class;
                break;
        }
    }

    function handleQueryFunction(node) {
        switch (node.properties.class) {
            case "table":
                node.name = node.properties.table;
                node.class = "relation";
                break;
            default:
                node.name = node.properties.class;
                break;
        }
    }

    // properties.class are the operators
    function handleLogicalOperator(node) {
        switch (node.properties.class) {
            case "join":
                node.name = node.properties.name;
                node.class = "join";
                break;
            case "relation":
                node.name = node.properties.name;
                node.class = "relation";
                break;
            case "tuples":
                if (node.properties.alias) {
                    node.name = node.properties.class + ":" + node.properties.alias;
                } else {
                    node.name = node.properties.class;
                }
                break;
            default:
                node.name = node.properties.class;
                break;
        }
    }

    // tags are the operators
    function handleLogicalOperator2(node) {
        switch (node.tag) {
            case "joinOp":
                node.name = node.tag.replace(/Op$/, '');
                node.class = "join";
                break;
            case "referenceOp":
                node.name = "ref:" + node.properties.ref;
                node.class = "reference";
                break;
            case "relationOp":
                node.name = node.properties.name;
                node.class = "relation";
                break;
            case "tuplesOp":
                if (node.properties.alias) {
                    node.name = node.tag.replace(/Op$/, '') + ":" + node.properties.alias;
                } else {
                    node.name = node.tag.replace(/Op$/, '');
                }
                break;
            default:
                node.name = node.tag.replace(/Op$/, '');
                break;
        }
    }

    // properties.class are the operators
    function handleFedOp(node) {
        switch (node.properties.class) {
            case "createtemptable":
            case "createtemptablefromquery":
            case "createtemptablefromtuples":
                if (node.properties.table) {
                    node.name = node.properties.table;
                } else {
                    node.name = node.properties.class;
                }
                node.class = "createtemptable";
                break;
            default:
                node.name = node.properties.class;
                break;
        }
    }

    function handleBinding(node) {
        if (node.properties && node.properties.name) {
            node.name = node.properties.name;
        } else if (node.properties && node.properties.ref) {
            node.name = node.properties.ref;
        } else {
            node.name = node.tag;
        }
    }

    // for calculation-language expression trees
    function handleDimensions(node) {
        if (node.text) {
            node.name = node.text;
        } else if (node.properties && node.properties.type) {
            node.name = node.properties.type;
        } else {
            node.name = node.tag;
        }
    }

    // extensions for calculation-language expression trees
    function handleExpression(node) {
        if (node.text) {
            node.name = node.text;
        } else if (node.properties && node.properties.name) {
            node.name = node.properties.name;
        } else if (node.properties && node.properties.value) {
            if (node.properties.type === "string") {
                node.name = "'" + node.properties.value + "'";
            } else {
                node.name = node.properties.value;
            }
        } else if (node.properties && node.properties.class) {
            node.name = node.properties.class;
        } else {
            node.name = node.tag;
        }
    }

    function generateDisplayNames(node) {
        // In-order traversal. Leaf node don't have children
        if (node.children) {
            for (var i = 0; i < node.children.length; i++) {
                generateDisplayNames(node.children[i]);
            }
        }
        switch (node.tag) {
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
                node.name = node.properties.formula;
                break;
            case "condition":
                if (node.properties) {
                    node.name = node.properties.op;
                } else {
                    node.name = node.tag;
                }
                break;
            case "field":
                if (node.text) {
                    node.name = node.text;
                    break;
                } else if (node.properties) {
                    node.name = node.properties.name;
                } else {
                    node.name = "field{}";
                }
                break;
            case "binding":
                handleBinding(node);
                break;
            case "relation":
            case "column":
            case "runquery-column":
                node.name = node.properties.name;
                break;
            case "dimensions":
                handleDimensions(node);
                break;
            case "expression":
                handleExpression(node);
                break;
            case "tuple":
            case "value":
                if (node.text) {
                    node.name = node.text;
                } else {
                    node.name = node.tag;
                }
                break;
            case "attribute":
            case "table":
            case "type":
                if (node.text) {
                    node.name = node.tag + ":" + node.text;
                } else if (node.properties && node.properties.name) {
                    node.name = node.tag + ":" + node.properties.name;
                } else {
                    node.name = node.tag;
                }
                break;
            default:
                if (node.properties && node.properties.class) {
                    switch (node.properties.class) {
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
                } else if (node.tag) {
                    node.name = node.tag;
                } else {
                    node.name = JSON.stringify(node);
                }
                break;
        }
    }

    return generateDisplayNames;
})();

// Assign symbols & classes to the nodes
function assignSymbolsAndClasses(treeData) {
    common.visit(treeData, function(n) {
        // Assign symbols
        if (n.properties && n.properties.join && n.class && n.class === "join") {
            n.symbol = n.properties.join + "-join-symbol";
        } else if (n.class && n.class === "relation") {
            n.symbol = "table-symbol";
        } else if (n.class && n.class === "createtemptable") {
            n.symbol = "temp-table-symbol";
        } else if (n.name && n.name === "runquery") {
            n.symbol = "run-query-symbol";
        }
        // Assign classes for incoming edge
        if (n.tag === "binding" || n.class === "createtemptable") {
            n.children.forEach(function(c) {
                c.edgeClass = "link-and-arrow";
            });
        } else if (n.name === "runquery") {
            n.children.forEach(function(c) {
                if (c.class === "createtemptable") {
                    c.edgeClass = "dotted-link";
                }
            });
        }
    }, function(d) {
        return d.children && d.children.length > 0 ? d.children : null;
    });
}

function collapseNodes(treeData, graphCollapse) {
    var streamline = graphCollapse === "s" ? common.streamline : common.collapseChildren;
    var collapseChildren = common.collapseChildren;
    if (graphCollapse !== 'n') {
        common.visit(treeData, function(d) {
            if (d.name) {
                var _name = d.fullName ? d.fullName : d.name;
                switch (_name) {
                    case 'condition':
                    case 'conditions':
                    case 'datasource':
                    case 'expressions':
                    case 'field':
                    case 'groupbys':
                    case 'imports':
                    case 'measures':
                    case 'metadata-record':
                    case 'metadata-records':
                    case 'orderbys':
                    case 'predicate':
                    case 'restrictions':
                    case 'runquery-columns':
                    case 'selects':
                    case 'schema':
                    case 'tid':
                    case 'top':
                    case 'tuples':
                        streamline(d);
                        return;
                    default:
                        break;
                }
            }
            if (d.class) {
                switch (d.class) {
                    case 'relation':
                        collapseChildren(d);
                        return;
                    default:
                        break;
                }
            }
        }, function(d) {
            return d.children && d.children.length > 0 ? d.children.slice(0) : null;
        });
    }
}

// Prepare the loaded data for visualization
function prepareTreeData(treeData, graphCollapse) {
    treeData = convertJSON(treeData);
    // Tag the tree root
    if (!treeData.tag) {
        treeData.tag = "result";
    }
    generateDisplayNames(treeData);
    assignSymbolsAndClasses(treeData);
    common.createParentLinks(treeData);
    colors.colorFederated(treeData);
    collapseNodes(treeData, graphCollapse);
    return treeData;
}

function loadTableauPlan(graphString, graphCollapse) {
    var result;
    var parser = new xml2js.Parser({
        explicitRoot: false,
        explicitChildren: true,
        preserveChildrenOrder: true,
        // Don't merge attributes. XML attributes will be stored in node["$"]
        mergeAttrs: false
    });
    parser.parseString(graphString, function(err, parsed) {
        if (err) {
            result = {error: "XML parse failed with '" + err + "'."};
        } else {
            result = {root: prepareTreeData(parsed, graphCollapse)};
        }
    });
    return result;
}

exports.loadTableauPlan = loadTableauPlan;

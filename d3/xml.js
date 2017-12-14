/*

XML Loader
--------------------------

Map the XML tree directly to a D3 tree, without any modifications.
Elements are displayed as tree nodes and the attributes are shown
in the tooltips.

*/

// Require node modules
var xmlParser = require('xml2js/lib/parser').Parser;

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
        name: tag,
        properties: properties,
        text: text,
        children: children
    };
}

function loadXml(graphString, _graphCollapse) {
    var result;
    var parser = new xmlParser({
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
            result = {root: convertJSON(parsed)};
        }
    });
    return result;
}

exports.loadXml = loadXml;

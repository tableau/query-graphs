/*

XML Loader
--------------------------

Map the XML tree directly to a D3 tree, without any modifications.
Elements are displayed as tree nodes and the attributes are shown
in the tooltips.

*/

import {Parser as XmlParser} from "xml2js/lib/parser";
import {TreeDescription, TreeNode} from "./tree-description";

interface ParsedXML {
    // Tag name
    "#name": string;
    // Text content
    _?: string;
    // Attributes
    $?: string[];
    // Children
    $$?: ParsedXML[];
}

// Convert JS objects as returned by xml2js parser to tree description format
function convertXML(node: ParsedXML): TreeNode {
    const children = [] as any[];
    let properties = {};
    let text: string | undefined;
    const tag = node["#name"];

    if (node.$) {
        properties = node.$;
    }
    if (node._) {
        text = node._;
    }
    if (node.$$) {
        for (const child of node.$$) {
            children.push(convertXML(child));
        }
    }

    return {
        name: tag,
        properties: properties,
        text: text,
        children: children,
    };
}

export function loadXml(graphString: string, _graphCollapse): TreeDescription {
    let result!: TreeDescription;
    const parser = new XmlParser({
        explicitRoot: false,
        explicitChildren: true,
        preserveChildrenOrder: true,
        // Don't merge attributes. XML attributes will be stored in node["$"]
        mergeAttrs: false,
    });
    parser.parseString(graphString, function(err: any, parsed: ParsedXML) {
        if (err) {
            throw new Error("XML parse failed with '" + err + "'.");
        } else {
            result = {root: convertXML(parsed)};
        }
    });
    return result;
}

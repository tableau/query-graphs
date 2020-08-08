/*

XML Loader
--------------------------

Map the XML tree directly to a D3 tree, without any modifications.
Elements are displayed as tree nodes and the attributes are shown
in the tooltips.

*/

import {Parser as XmlParser} from "xml2js/lib/parser";
import {TreeDescription, TreeNode} from "./tree-description";

export interface ParsedXML {
    // Tag name
    "#name": string;
    // Text content
    _?: string;
    // Attributes
    $?: string[];
    // Children
    $$?: ParsedXML[];
}

export function typesafeXMLParse(str: string): ParsedXML {
    let result!: ParsedXML;
    const parser = new XmlParser({
        explicitRoot: false,
        explicitChildren: true,
        preserveChildrenOrder: true,
        // Don't merge attributes. XML attributes will be stored in node["$"]
        mergeAttrs: false,
    });
    parser.parseString(str, function(err: any, parsed: ParsedXML) {
        if (err) {
            throw new Error("XML parse failed with '" + err + "'.");
        } else {
            result = parsed;
        }
    });
    return result;
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
    const xml = typesafeXMLParse(graphString);
    return {root: convertXML(xml)};
}

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
    parser.parseString(str, (err: any, parsed: ParsedXML) => {
        if (err) {
            throw new Error("XML parse failed with '" + err + "'.");
        } else {
            result = parsed;
        }
    });
    return result;
}

// Convert JS objects as returned by xml2js parser to tree description format
function convertXML(xml: ParsedXML): TreeNode {
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

/*

XML Loader
--------------------------

Map the XML tree directly to a D3 tree, without any modifications.
Elements are displayed as tree nodes and the attributes are shown
in the tooltips.

*/

import type {TreeDescription, TreeNode} from "../tree-description";

export interface ParsedXML {
    tag: string;
    text?: string;
    attrs?: Record<string, string>;
    nodes?: ParsedXML[];
}

export function typesafeXMLParse(str: string): ParsedXML {
    const parser = new DOMParser();
    const doc = parser.parseFromString(str, "text/xml");

    if (doc.querySelector("parsererror")) {
        throw new Error("XML parse failed");
    }

    return domNodeToXML(doc.documentElement);
}

function domNodeToXML(element: Element): ParsedXML {
    const attrs: Record<string, string> = {};
    for (const attr of Array.from(element.attributes)) {
        attrs[attr.name] = attr.value;
    }

    const nodes: ParsedXML[] = [];
    const textParts: string[] = [];

    for (const child of Array.from(element.childNodes)) {
        if (child.nodeType === 1) {
            // Node.ELEMENT_NODE
            nodes.push(domNodeToXML(child as Element));
        } else if (child.nodeType === 3 || child.nodeType === 4) {
            // Node.TEXT_NODE or Node.CDATA_SECTION_NODE
            const text = child.textContent?.trim();
            if (text) {
                textParts.push(text);
            }
        }
    }
    const textContent = textParts.join("");

    return {
        tag: element.tagName,
        text: textContent || undefined,
        attrs: Object.keys(attrs).length > 0 ? attrs : undefined,
        nodes: nodes.length > 0 ? nodes : undefined,
    };
}

function convertXML(xml: ParsedXML): TreeNode {
    const tag = xml.tag;
    const text: string | undefined = xml.text;
    const properties = new Map<string, string>();
    if (text) properties.set("~text", text);
    if (xml.attrs) {
        for (const key of Object.keys(xml.attrs)) {
            properties.set(key, xml.attrs[key]);
        }
    }
    const children = [] as TreeNode[];
    for (const child of xml.nodes ?? []) {
        children.push(convertXML(child));
    }

    return {
        name: tag,
        properties: properties,
        children: children,
    };
}

export function loadXml(graphString: string): TreeDescription {
    const xml = typesafeXMLParse(graphString);
    return {root: convertXML(xml)};
}

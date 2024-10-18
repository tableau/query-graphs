/*

Tableau query plans (e.g., logical queries)
--------------------------

Tableau's query plans are stored as XML. We first load that XML using xml2js
and convert it literally into a query tree using `convertJSON`. The XML
already provides us the structure of the rendered tree.

*/

// Require node modules
import {IconName, TreeDescription, TreeNode} from "./tree-description";
import {typesafeXMLParse, ParsedXML} from "./xml";

function normalizeLogicalOperator(tag: string, clazz?: string) {
    // Logical queries
    // There are two representations:
    //   <joinOp class='logical-operator' comparison='equal-to' join='inner' join-constraints='pk-fk'>
    // and
    //   <logical-operator class='join' comparison='equal-to' join='left' join-constraints='none'>
    if (tag == "logical-operator") {
        return clazz;
    }
    if (clazz == "logical-operator" && tag.endsWith("Op")) {
        return tag.substring(0, tag.length - 2);
    }
    return undefined;
}

function normalizeLogicalExpression(tag: string, clazz?: string) {
    if (tag == "logical-expression") {
        return clazz;
    }
    if (clazz == "logical-expression" && tag.endsWith("Exp")) {
        return tag.substring(0, tag.length - 3);
    }
    return undefined;
}

interface NodeRenderingDescription {
    displayName: string;
    icon?: IconName;
    crosslinkId?: string;
}

function extractProperty(properties: Map<string, string>, key: string) {
    const value = properties.get(key);
    properties.delete(key);
    return value;
}

function getNodeRenderingConfig(tag: string, properties: Map<string, string>): NodeRenderingDescription {
    switch (tag) {
        case "join": {
            const joinType = properties.get("join");
            const joinIcons = {
                inner: "inner-join-symbol",
                outer: "full-join-symbol",
                left: "left-join-symbol",
                right: "right-join-symbol",
            };
            const icon = joinIcons[joinType ?? ""] ?? "inner-join-symbol";
            return {displayName: `${joinType} join`, icon};
        }
        case "aggregate":
            return {displayName: tag, icon: "groupby-symbol"};
        case "relation":
            return {displayName: properties.get("name") ?? tag, icon: "table-symbol"};
        case "tuples":
            return {displayName: properties.get("alias") ?? tag, icon: "table-symbol"};
        case "select":
            return {displayName: tag, icon: "filter-symbol"};
        case "runquery":
            return {displayName: tag, icon: "run-query-symbol"};
        case "fed-op": {
            const clazz = properties.get("class");
            switch (clazz) {
                case "createtemptable":
                case "createtemptablefromquery":
                case "createtemptablefromtuples":
                    return {displayName: properties.get("table") ?? clazz, icon: "temp-table-symbol"};
                case "runquery":
                    return {displayName: tag, icon: "run-query-symbol"};
            }
            break;
        }
        case "field":
            return {displayName: extractProperty(properties, "~text") ?? extractProperty(properties, "name") ?? tag};
        case "identifier":
            return {displayName: extractProperty(properties, "identifier") ?? tag};
        case "funcallExp":
            return {displayName: extractProperty(properties, "function") ?? tag};
        case "literal":
            return {displayName: properties?.get("datatype") + ":" + properties?.get("value")};
        case "referenceExp":
            return {displayName: "ref:" + properties?.get("ref")};
        case "condition":
            return {displayName: extractProperty(properties, "op") ?? tag};
        case "binding":
            return {displayName: extractProperty(properties, "name") ?? extractProperty(properties, "ref") ?? tag};
        case "calculation":
            return {displayName: extractProperty(properties, "formula") ?? tag};
    }
    return {displayName: tag};
}

function isAlwaysExpanded(xml: ParsedXML) {
    const tag = xml["#name"];
    const childLogicalOp = normalizeLogicalOperator(xml["#name"], xml.$?.class) !== undefined;
    return childLogicalOp || tag == "fed-op" || tag == "logical-query";
}

// Convert JSON as returned by xml2js parser to d3 tree format
function convertXML(xml: ParsedXML): TreeNode {
    let tag = xml["#name"];

    // The properties
    const properties = new Map<string, string>();
    const text: string | undefined = xml._?.trim();
    if (text) properties.set("~text", text);
    if (xml.$) {
        for (const key of Object.getOwnPropertyNames(xml.$)) {
            properties.set(key, xml.$[key]);
        }
    }

    // Normalize the representation of logical operators
    const operatorType = normalizeLogicalOperator(tag, properties.get("class"));
    const exprType = normalizeLogicalExpression(tag, properties.get("class"));
    if (operatorType) {
        properties.delete("class");
        tag = operatorType;
    } else if (exprType) {
        properties.delete("class");
        tag = exprType;
    }

    const nodeRendering = getNodeRenderingConfig(tag, properties);
    const name = nodeRendering.displayName ?? tag;
    const icon = nodeRendering.icon;

    const expandedChildren = [] as TreeNode[];
    const collapsedChildren = [] as TreeNode[];
    for (const child of xml.$$ ?? []) {
        const children = isAlwaysExpanded(child) ? expandedChildren : collapsedChildren;
        children.push(convertXML(child));
    }

    return {
        name,
        icon,
        properties: properties,
        children: expandedChildren,
        collapsedChildren,
        expandedByDefault: !isAlwaysExpanded(xml) && expandedChildren.length == 0,
    };
}

export function loadTableauPlan(graphString: string): TreeDescription {
    const xml = typesafeXMLParse(graphString);
    const root = convertXML(xml);
    return {root: root, crosslinks: undefined};
}

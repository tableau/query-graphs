import type {TreeDescription} from "../tree-description";
import {hyperPlanLoader} from "./hyper";
import {jsonPlanLoader} from "./json";
import type {Json} from "./loader-utils";
import {postgresPlanLoader} from "./postgres";
import {tableauPlanLoader} from "./tableau";
import type {PlanLoader} from "./types";
import {parseXml, type ParsedXML, xmlPlanLoader} from "./xml";

export interface LoadedPlan {
    format: string;
    tree: TreeDescription;
}

export interface LoadPlanOptions {
    format?: string;
}

export {InvalidPlanError, type PlanLoader} from "./types";

export class PlanSyntaxError extends Error {
    readonly expectedSyntax: "json" | "xml" | "json-or-xml";
    readonly format: string | undefined;
    readonly jsonError: unknown | undefined;
    readonly xmlError: unknown | undefined;

    constructor(
        expectedSyntax: "json" | "xml" | "json-or-xml",
        format: string | undefined,
        jsonError?: unknown,
        xmlError?: unknown,
    ) {
        const context = format === undefined ? "query plan" : `${format} query plan`;
        const message =
            expectedSyntax === "json"
                ? `Cannot load ${context}: input is not valid JSON: ${String(jsonError)}`
                : expectedSyntax === "xml"
                  ? `Cannot load ${context}: input is not valid XML: ${String(xmlError)}`
                  : `Not a valid query plan:\nJSON: ${String(jsonError)}\nXML: ${String(xmlError)}`;
        const errors = [jsonError, xmlError].filter((error) => error !== undefined);
        super(message, {cause: new AggregateError(errors)});
        this.name = "PlanSyntaxError";
        this.expectedSyntax = expectedSyntax;
        this.format = format;
        this.jsonError = jsonError;
        this.xmlError = xmlError;
    }
}

export class UnknownPlanFormatError extends Error {
    readonly format: string;
    readonly availableFormats: readonly string[];

    constructor(format: string, availableFormats: readonly string[]) {
        super(`Unknown query plan format '${format}'. Available formats: ${availableFormats.join(", ")}`);
        this.name = "UnknownPlanFormatError";
        this.format = format;
        this.availableFormats = availableFormats;
    }
}

export const jsonPlanLoaders: readonly PlanLoader<Json>[] = [postgresPlanLoader, hyperPlanLoader, jsonPlanLoader];
export const xmlPlanLoaders: readonly PlanLoader<ParsedXML>[] = [tableauPlanLoader, xmlPlanLoader];

function loadMatchingPlan<Input>(input: Input, loaders: readonly PlanLoader<Input>[], format?: string): LoadedPlan | undefined {
    for (const loader of loaders) {
        if (format === undefined ? loader.matches(input) : loader.format === format) {
            return {format: loader.format, tree: loader.load(input)};
        }
    }
    return undefined;
}

function stripSurroundingText(text: string): string {
    const planStart = text.search(/[<{[]/);
    const planEnd = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"), text.lastIndexOf(">"));
    return planStart >= 0 && planEnd >= planStart ? text.substring(planStart, planEnd + 1) : text;
}

export function loadPlanFromText(text: string, options: LoadPlanOptions = {}): LoadedPlan {
    const planText = stripSurroundingText(text);
    const format = options.format;
    const acceptsJson = format === undefined || jsonPlanLoaders.some((loader) => loader.format === format);
    const acceptsXml = format === undefined || xmlPlanLoaders.some((loader) => loader.format === format);
    if (!acceptsJson && !acceptsXml) {
        const availableFormats = [...jsonPlanLoaders, ...xmlPlanLoaders].map((loader) => loader.format);
        throw new UnknownPlanFormatError(format, availableFormats);
    }

    let json: Json | undefined;
    let jsonError: unknown;
    if (acceptsJson) {
        try {
            json = JSON.parse(planText) as Json;
        } catch (error) {
            jsonError = error;
        }
    }
    if (json !== undefined) {
        const plan = loadMatchingPlan(json, jsonPlanLoaders, format);
        if (plan !== undefined) return plan;
    }

    let xml: ParsedXML | undefined;
    let xmlError: unknown;
    if (acceptsXml) {
        try {
            xml = parseXml(planText);
        } catch (error) {
            xmlError = error;
        }
    }
    if (xml !== undefined) {
        const plan = loadMatchingPlan(xml, xmlPlanLoaders, format);
        if (plan !== undefined) return plan;
    }

    if (format !== undefined) {
        throw acceptsJson
            ? new PlanSyntaxError("json", format, jsonError)
            : new PlanSyntaxError("xml", format, undefined, xmlError);
    }
    throw new PlanSyntaxError("json-or-xml", undefined, jsonError, xmlError);
}

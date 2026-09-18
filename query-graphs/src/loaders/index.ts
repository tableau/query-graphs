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

function loadWithPlanLoader<Input>(input: Input, loader: PlanLoader<Input>): LoadedPlan {
    return {format: loader.format, tree: loader.load(input)};
}

function loadMatchingPlan<Input>(input: Input, loaders: readonly PlanLoader<Input>[]): LoadedPlan {
    const loader = loaders.find((candidate) => candidate.matches(input));
    if (loader === undefined) {
        throw new Error("No fallback plan loader registered");
    }
    return loadWithPlanLoader(input, loader);
}

function parseJson(text: string): Json {
    return JSON.parse(text) as Json;
}

function stripSurroundingText(text: string): string {
    const planStart = text.search(/[<{[]/);
    const planEnd = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"), text.lastIndexOf(">"));
    return planStart >= 0 && planEnd >= planStart ? text.substring(planStart, planEnd + 1) : text;
}

function loadPlanFromTextAs(text: string, format: string): LoadedPlan {
    const jsonLoader = jsonPlanLoaders.find((loader) => loader.format === format);
    if (jsonLoader !== undefined) {
        let json: Json;
        try {
            json = parseJson(text);
        } catch (jsonError) {
            throw new PlanSyntaxError("json", format, jsonError);
        }
        return loadWithPlanLoader(json, jsonLoader);
    }

    const xmlLoader = xmlPlanLoaders.find((loader) => loader.format === format);
    if (xmlLoader !== undefined) {
        let xml: ParsedXML;
        try {
            xml = parseXml(text);
        } catch (xmlError) {
            throw new PlanSyntaxError("xml", format, undefined, xmlError);
        }
        return loadWithPlanLoader(xml, xmlLoader);
    }

    const availableFormats = [...jsonPlanLoaders, ...xmlPlanLoaders].map((loader) => loader.format);
    throw new UnknownPlanFormatError(format, availableFormats);
}

export function loadPlanFromText(text: string, options: LoadPlanOptions = {}): LoadedPlan {
    const planText = stripSurroundingText(text);
    if (options.format !== undefined) {
        return loadPlanFromTextAs(planText, options.format);
    }

    let json: Json | undefined;
    let jsonError: unknown;
    try {
        json = parseJson(planText);
    } catch (error) {
        jsonError = error;
    }
    if (json !== undefined) {
        return loadMatchingPlan(json, jsonPlanLoaders);
    }

    let xml: ParsedXML;
    try {
        xml = parseXml(planText);
    } catch (xmlError) {
        throw new PlanSyntaxError("json-or-xml", undefined, jsonError, xmlError);
    }
    return loadMatchingPlan(xml, xmlPlanLoaders);
}

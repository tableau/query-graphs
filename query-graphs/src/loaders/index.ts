import type {TextDocument, TreeDescription} from "../tree-description";
import {duckDbPlanLoader} from "./duckdb";
import {hyperPlanLoader} from "./hyper";
import {jsonPlanLoader} from "./json";
import type {Json} from "./loader-utils";
import {postgresPlanLoader} from "./postgres";
import {tableauPlanLoader} from "./tableau";
import {InvalidPlanError, type PlanLoader, UnknownPlanFormatError} from "./types";
import type {PlanLoadContext} from "./types";
import {umbraPlanLoader} from "./umbra";
import {parseXml, type ParsedXML, xmlPlanLoader} from "./xml";
import {parsePositionedJson} from "./json-source";

export interface LoadedPlan {
    format: string;
    tree: TreeDescription;
}

export interface LoadPlanOptions {
    format?: string;
}

export {parsePositionedJson, type JsonSourceLocator, type PositionedJson} from "./json-source";
export {InvalidPlanError, type PlanLoadContext, type PlanLoader, UnknownPlanFormatError} from "./types";

// Order matters: format-specific loaders must precede the more permissive Hyper loader, and generic fallbacks must stay last.
export const jsonPlanLoaders: readonly PlanLoader<Json>[] = [
    postgresPlanLoader,
    umbraPlanLoader,
    duckDbPlanLoader,
    hyperPlanLoader,
    jsonPlanLoader,
];
export const xmlPlanLoaders: readonly PlanLoader<ParsedXML>[] = [tableauPlanLoader, xmlPlanLoader];
const planDocumentId = "plan";

function loadMatchingPlan<Input>(
    input: Input,
    loaders: readonly PlanLoader<Input>[],
    errors: unknown[],
    format?: string,
    context?: PlanLoadContext,
): LoadedPlan | undefined {
    for (const loader of loaders) {
        if (format === undefined ? loader.matches(input) : loader.format === format) {
            try {
                return {format: loader.format, tree: loader.load(input, context)};
            } catch (error) {
                errors.push(error);
            }
        }
    }
    return undefined;
}

function stripSurroundingText(text: string): string {
    const planStart = text.search(/[<{[]/);
    const planEnd = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"), text.lastIndexOf(">"));
    return planStart >= 0 && planEnd >= planStart ? text.substring(planStart, planEnd + 1) : text;
}

function addPlanDocument(plan: LoadedPlan, text: string, language: string): LoadedPlan {
    const planDocument: TextDocument = {id: planDocumentId, title: "Query Plan", text, language};
    plan.tree.textDocuments ??= [];
    plan.tree.textDocuments.push(planDocument);
    return plan;
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

    const errors: unknown[] = [];
    if (acceptsJson) {
        try {
            // CodeMirror and other browser text models use LF internally, so keep the
            // displayed document and its source offsets in that canonical form.
            const jsonText = planText.replace(/\r\n?/g, "\n");
            const json = parsePositionedJson(jsonText, planDocumentId);
            const plan = loadMatchingPlan(json.value, jsonPlanLoaders, errors, format, {jsonSource: json.source});
            if (plan !== undefined) return addPlanDocument(plan, jsonText, "json");
        } catch (error) {
            errors.push(error);
        }
    }

    if (acceptsXml) {
        try {
            const xml = parseXml(planText);
            const plan = loadMatchingPlan(xml, xmlPlanLoaders, errors, format);
            if (plan !== undefined) return addPlanDocument(plan, planText, "xml");
        } catch (error) {
            errors.push(error);
        }
    }

    throw new InvalidPlanError(format, {cause: new AggregateError(errors)});
}

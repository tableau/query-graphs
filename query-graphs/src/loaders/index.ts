import type {TreeDescription} from "../tree-description";
import {hyperPlanLoader} from "./hyper";
import {jsonPlanLoader} from "./json";
import type {Json} from "./loader-utils";
import {postgresPlanLoader} from "./postgres";
import {tableauPlanLoader} from "./tableau";
import {InvalidPlanError, type PlanLoader, UnknownPlanFormatError} from "./types";
import {umbraPlanLoader} from "./umbra";
import {parseXml, type ParsedXML, xmlPlanLoader} from "./xml";

export interface LoadedPlan {
    format: string;
    tree: TreeDescription;
}

export interface LoadPlanOptions {
    format?: string;
}

export {InvalidPlanError, type PlanLoader, UnknownPlanFormatError} from "./types";

// Order matters: format-specific loaders must precede the more permissive Hyper loader, and generic fallbacks must stay last.
export const jsonPlanLoaders: readonly PlanLoader<Json>[] = [postgresPlanLoader, umbraPlanLoader, hyperPlanLoader, jsonPlanLoader];
export const xmlPlanLoaders: readonly PlanLoader<ParsedXML>[] = [tableauPlanLoader, xmlPlanLoader];

function loadMatchingPlan<Input>(
    input: Input,
    loaders: readonly PlanLoader<Input>[],
    errors: unknown[],
    format?: string,
): LoadedPlan | undefined {
    for (const loader of loaders) {
        if (format === undefined ? loader.matches(input) : loader.format === format) {
            try {
                return {format: loader.format, tree: loader.load(input)};
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
            const json = JSON.parse(planText) as Json;
            const plan = loadMatchingPlan(json, jsonPlanLoaders, errors, format);
            if (plan !== undefined) return plan;
        } catch (error) {
            errors.push(error);
        }
    }

    if (acceptsXml) {
        try {
            const xml = parseXml(planText);
            const plan = loadMatchingPlan(xml, xmlPlanLoaders, errors, format);
            if (plan !== undefined) return plan;
        } catch (error) {
            errors.push(error);
        }
    }

    throw new InvalidPlanError(format, {cause: new AggregateError(errors)});
}

import type {TreeDescription} from "../tree-description";
import {hyperPlanLoader} from "./hyper";
import {jsonPlanLoader} from "./json";
import type {Json} from "./loader-utils";
import {postgresPlanLoader} from "./postgres";
import {tableauPlanLoader} from "./tableau";
import {PlanSyntaxError, type PlanLoader, UnknownPlanFormatError} from "./types";
import {parseXml, type ParsedXML, xmlPlanLoader} from "./xml";

export interface LoadedPlan {
    format: string;
    tree: TreeDescription;
}

export interface LoadPlanOptions {
    format?: string;
}

export {InvalidPlanError, PlanSyntaxError, type PlanLoader, UnknownPlanFormatError} from "./types";

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

    const syntaxErrors: unknown[] = [];
    if (acceptsJson) {
        let parsed = false;
        try {
            const json = JSON.parse(planText) as Json;
            parsed = true;
            const plan = loadMatchingPlan(json, jsonPlanLoaders, format);
            if (plan !== undefined) return plan;
        } catch (error) {
            if (parsed) throw error;
            syntaxErrors.push(error);
        }
    }

    if (acceptsXml) {
        let parsed = false;
        try {
            const xml = parseXml(planText);
            parsed = true;
            const plan = loadMatchingPlan(xml, xmlPlanLoaders, format);
            if (plan !== undefined) return plan;
        } catch (error) {
            if (parsed) throw error;
            syntaxErrors.push(error);
        }
    }

    throw new PlanSyntaxError(format, syntaxErrors);
}

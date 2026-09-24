import type {TextDocument, TreeDescription} from "../tree-description";
import {duckDbPlanLoader} from "./duckdb";
import {hyperPlanLoader} from "./hyper";
import {jsonPlanLoader} from "./json";
import type {Json} from "./loader-utils";
import {postgresPlanLoader} from "./postgres";
import {createSqlSourceLocator} from "./sql-source";
import {tableauPlanLoader} from "./tableau";
import {InvalidPlanError, type PlanLoadContext, type PlanLoader, UnknownPlanFormatError} from "./types";
import {umbraPlanLoader} from "./umbra";
import {parseXml, type ParsedXML, xmlPlanLoader} from "./xml";

export interface LoadedPlan {
    format: string;
    tree: TreeDescription;
}

export interface LoadPlanOptions {
    format?: string;
    sql?: string;
}

export {createSqlSourceLocator, type SqlSourceLocator} from "./sql-source";
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
    const planDocument: TextDocument = {id: "plan", title: "Query Plan", text, language};
    plan.tree.textDocuments ??= [];
    plan.tree.textDocuments.push(planDocument);
    return plan;
}

function addSqlDocument(plan: LoadedPlan, queryDocument: TextDocument | undefined): LoadedPlan {
    if (queryDocument === undefined) return plan;
    plan.tree.textDocuments ??= [];
    const existingQuery = plan.tree.textDocuments.findIndex(({id}) => id === queryDocument.id);
    if (existingQuery === -1) {
        plan.tree.textDocuments.push(queryDocument);
    } else {
        plan.tree.textDocuments[existingQuery] = queryDocument;
    }
    return plan;
}

/**
 * Pretty-prints the original token stream after `JSON.parse` has validated it.
 * Re-serializing the parsed value with `JSON.stringify` would round large numbers,
 * discard duplicate keys, and potentially reorder keys, making the displayed plan
 * differ from the source supplied by the user.
 */
function formatJsonDocument(text: string): string {
    if (/[\r\n]/.test(text)) return text;

    let formatted = "";
    let indent = 0;
    let inString = false;
    let escaped = false;
    const whitespace = new Set([" ", "\t", "\r", "\n"]);
    const indentation = () => " ".repeat(indent * 3);

    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (inString) {
            formatted += character;
            if (escaped) {
                escaped = false;
            } else if (character === "\\") {
                escaped = true;
            } else if (character === '"') {
                inString = false;
            }
            continue;
        }

        if (character === '"') {
            inString = true;
            formatted += character;
        } else if (character === "{" || character === "[") {
            formatted += character;
            indent++;
            const closingCharacter = character === "{" ? "}" : "]";
            let nextIndex = index + 1;
            while (whitespace.has(text[nextIndex])) nextIndex++;
            if (text[nextIndex] !== closingCharacter) formatted += `\n${indentation()}`;
        } else if (character === "}" || character === "]") {
            indent--;
            let previousIndex = index - 1;
            while (whitespace.has(text[previousIndex])) previousIndex--;
            if (text[previousIndex] !== "{" && text[previousIndex] !== "[") formatted += `\n${indentation()}`;
            formatted += character;
        } else if (character === ",") {
            formatted += `,\n${indentation()}`;
        } else if (character === ":") {
            formatted += ": ";
        } else if (!whitespace.has(character)) {
            formatted += character;
        }
    }

    return formatted;
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
    const sqlSource = options.sql === undefined ? undefined : createSqlSourceLocator(options.sql);
    const context: PlanLoadContext = {sqlSource};
    if (acceptsJson) {
        try {
            const json = JSON.parse(planText) as Json;
            const plan = loadMatchingPlan(json, jsonPlanLoaders, errors, format, context);
            if (plan !== undefined)
                return addPlanDocument(addSqlDocument(plan, sqlSource?.document), formatJsonDocument(planText), "json");
        } catch (error) {
            errors.push(error);
        }
    }

    if (acceptsXml) {
        try {
            const xml = parseXml(planText);
            const plan = loadMatchingPlan(xml, xmlPlanLoaders, errors, format, context);
            if (plan !== undefined) return addPlanDocument(addSqlDocument(plan, sqlSource?.document), planText, "xml");
        } catch (error) {
            errors.push(error);
        }
    }

    throw new InvalidPlanError(format, {cause: new AggregateError(errors)});
}

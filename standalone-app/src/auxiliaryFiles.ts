import type {TextDocument} from "@tableau/query-graphs/lib/tree-description";
import {loadPlanFromText} from "@tableau/query-graphs/lib/loaders";
import type {LoadedPlan} from "@tableau/query-graphs/lib/loaders";
import {loadFileText} from "./loadFileText";
import {mergeUrlParameters} from "./urlParameters";

export interface AuxiliaryFileReference {
    logicalFilename: string;
    url: string;
}

export interface AuxiliaryFileError {
    name: string;
    message: string;
}

export async function loadPlanWithAuxiliaryFiles(
    planUrl: URL,
    references: readonly AuxiliaryFileReference[],
    baseUrl: URL,
    signal: AbortSignal,
): Promise<{plan: LoadedPlan; errors: AuxiliaryFileError[]}> {
    validateAuxiliaryFileReferences(references);
    const [planText, results] = await Promise.all([
        loadFileText(planUrl, signal),
        Promise.all(
            references.map(async (reference) => {
                try {
                    const text = await loadFileText(new URL(reference.url, baseUrl), signal);
                    return {reference, text};
                } catch (error) {
                    if (signal.aborted) throw error;
                    return {reference, error};
                }
            }),
        ),
    ]);
    signal.throwIfAborted();
    const queryText = results.find(({reference, text}) => reference.logicalFilename === "query.sql" && text !== undefined)?.text;
    const plan = loadPlanFromText(planText, {sql: queryText});
    const sqlDocument = plan.tree.textDocuments?.find(({id}) => id === "query");
    if (queryText !== undefined && sqlDocument) sqlDocument.title = "query.sql";
    plan.tree.textDocuments ??= [];
    for (const {reference, text} of results) {
        if (reference.logicalFilename !== "query.sql" && text !== undefined) {
            plan.tree.textDocuments.push(createAuxiliaryFileDocument(reference, text));
        }
    }
    const errors = results.flatMap(({reference, error}) =>
        error === undefined
            ? []
            : [{name: reference.logicalFilename, message: error instanceof Error ? error.message : "Unknown error"}],
    );
    return {plan, errors};
}

// Alias normalization happens before duplicate validation, so both spellings resolve
// to the same logical filename and are rejected together.
export function getAuxiliaryFileReferences(url: URL): AuxiliaryFileReference[] {
    return [...mergeUrlParameters(url).entries()].flatMap(([key, value]) => {
        const match = /^file\[(.+)\]$/.exec(key);
        if (match) return [{logicalFilename: match[1], url: value}];
        return key === "sql-file" ? [{logicalFilename: "query.sql", url: value}] : [];
    });
}

export function clearAuxiliaryFileParameters(url: URL): URL {
    const next = new URL(url);
    const params = mergeUrlParameters(next);
    for (const key of [...params.keys()]) if (/^file\[.+\]$/.test(key) || key === "sql-file") params.delete(key);
    next.search = "";
    next.hash = params.toString() ? `#${params.toString()}` : "";
    return next;
}

export function getAuxiliaryFileLanguage(logicalFilename: string): string | undefined {
    const filename = logicalFilename.toLowerCase();
    if (filename.endsWith(".json")) return "json";
    if (filename.endsWith(".sql")) return "sql";
    return undefined;
}

export function createAuxiliaryFileDocument(reference: AuxiliaryFileReference, text: string): TextDocument {
    return {
        id: `auxiliary:${reference.logicalFilename}`,
        title: reference.logicalFilename,
        text: text.replace(/\r\n?/g, "\n"),
        language: getAuxiliaryFileLanguage(reference.logicalFilename),
    };
}

export function validateAuxiliaryFileReferences(references: readonly AuxiliaryFileReference[]): void {
    const names = new Set<string>();
    for (const {logicalFilename} of references) {
        if (names.has(logicalFilename)) throw new Error(`Duplicate auxiliary file name: ${logicalFilename}`);
        names.add(logicalFilename);
    }
}

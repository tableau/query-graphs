import type {TextDocument} from "@tableau/query-graphs/lib/tree-description";
import {loadPlanFromText} from "@tableau/query-graphs/lib/loaders";
import type {LoadedPlan} from "@tableau/query-graphs/lib/loaders";
import {loadFileText} from "./loadFileText";

export interface FileReference {
    logicalFilename: string;
    url: string;
}

export interface FileError {
    name: string;
    message: string;
}

export function getFileReferences(url: URL): FileReference[] {
    // Normalize aliases before duplicate validation so aliases and named files share one namespace.
    return [...new URLSearchParams(url.hash.slice(1)).entries()].flatMap(([key, value]) => {
        const match = /^file\[(.+)\]$/.exec(key);
        if (match) return [{logicalFilename: match[1], url: value}];
        if (key === "file") return [{logicalFilename: "plan.json", url: value}];
        if (key === "sql-file") return [{logicalFilename: "query.sql", url: value}];
        return [];
    });
}

export function validateFileReferences(references: readonly FileReference[]): void {
    const names = new Set<string>();
    let mainPlans = 0;
    for (const {logicalFilename} of references) {
        if (names.has(logicalFilename)) throw new Error(`Duplicate file name: ${logicalFilename}`);
        names.add(logicalFilename);
        if (logicalFilename === "plan.json" || logicalFilename === "plan.xml") mainPlans++;
    }
    if (mainPlans > 1) throw new Error("Only one main plan file is allowed (plan.json or plan.xml)");
}

export async function loadPlanFromFiles(
    references: readonly FileReference[],
    baseUrl: URL,
    signal: AbortSignal,
): Promise<{plan: LoadedPlan; errors: FileError[]}> {
    validateFileReferences(references);
    const planReference = references.find(({logicalFilename}) => logicalFilename === "plan.json" || logicalFilename === "plan.xml");
    if (!planReference) throw new Error("No main plan file found. Add file[plan.json] or file[plan.xml].");
    const results = await Promise.all(
        references.map(async (reference) => {
            try {
                // Relative references are resolved against the app URL so generated example links work consistently.
                const text = await loadFileText(new URL(reference.url, baseUrl), signal);
                return {reference, text};
            } catch (error) {
                if (signal.aborted) throw error;
                return {reference, error};
            }
        }),
    );
    signal.throwIfAborted();
    const planResult = results.find(({reference}) => reference === planReference)!;
    if (planResult.text === undefined) {
        const message = planResult.error instanceof Error ? planResult.error.message : "Unknown error";
        throw new Error(`Failed to load ${planReference.logicalFilename}: ${message}`, {cause: planResult.error});
    }
    const sqlText = results.find(({reference, text}) => reference.logicalFilename === "query.sql" && text !== undefined)?.text;
    let plan: LoadedPlan;
    try {
        plan = loadPlanFromText(planResult.text, {sql: sqlText});
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        throw new Error(`Failed to parse ${planReference.logicalFilename}: ${message}`, {cause: error});
    }
    const sqlDocument = plan.tree.textDocuments?.find(({id}) => id === "query");
    if (sqlText !== undefined && sqlDocument) sqlDocument.title = "query.sql";
    plan.tree.textDocuments ??= [];
    for (const {reference, text} of results) {
        if (reference !== planReference && reference.logicalFilename !== "query.sql" && text !== undefined) {
            plan.tree.textDocuments.push(createFileDocument(reference, text));
        }
    }
    const errors = results.flatMap(({reference, error}) =>
        error === undefined
            ? []
            : [{name: reference.logicalFilename, message: error instanceof Error ? error.message : "Unknown error"}],
    );
    return {plan, errors};
}

export function clearFileParameters(url: URL): URL {
    const next = new URL(url);
    const params = new URLSearchParams(next.hash.slice(1));
    for (const key of [...params.keys()]) {
        if (/^file(?:\[.*\])?$/.test(key) || key === "sql-file") params.delete(key);
    }
    next.search = "";
    next.hash = params.toString() ? `#${params.toString()}` : "";
    return next;
}

export function setFileReferences(url: URL, references: readonly FileReference[]): URL {
    const next = clearFileParameters(url);
    const params = new URLSearchParams(next.hash.slice(1));
    for (const {logicalFilename, url: fileUrl} of references) params.append(`file[${logicalFilename}]`, fileUrl);
    next.hash = `#${params.toString()}`;
    return next;
}

export function getFileLanguage(logicalFilename: string): string | undefined {
    const filename = logicalFilename.toLowerCase();
    if (filename.endsWith(".json")) return "json";
    if (filename.endsWith(".sql")) return "sql";
    return undefined;
}

export function createFileDocument(reference: FileReference, text: string): TextDocument {
    return {
        id: `file:${reference.logicalFilename}`,
        title: reference.logicalFilename,
        text: text.replace(/\r\n?/g, "\n"),
        language: getFileLanguage(reference.logicalFilename),
    };
}

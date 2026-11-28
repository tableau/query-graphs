import {validateFileReferences} from "./files";
import type {FileReference} from "./files";

export interface UrlDuplicateMetadata {
    fileNames: readonly string[];
    legacyFile: boolean;
    legacySqlFile: boolean;
    title: boolean;
    uploadServer: boolean;
}

export interface UrlValidation {
    errors: string[];
    hasDuplicates: boolean;
}

export function validateAppUrl(references: readonly FileReference[], duplicateMetadata: UrlDuplicateMetadata): UrlValidation {
    const errors: string[] = [];
    const seenNames = new Set<string>();
    const aliasCollisions = new Set<string>();
    for (const {logicalFilename} of references) {
        if (seenNames.has(logicalFilename)) aliasCollisions.add(logicalFilename);
        seenNames.add(logicalFilename);
    }
    for (const name of duplicateMetadata.fileNames) errors.push(`The file name “${name}” appears more than once.`);
    if (duplicateMetadata.legacyFile)
        errors.push("The file name “plan.json” appears more than once through the legacy file parameter.");
    if (duplicateMetadata.legacySqlFile)
        errors.push("The file name “query.sql” appears more than once through the legacy SQL file parameter.");
    if (duplicateMetadata.title) errors.push("The “title” parameter appears more than once.");
    if (duplicateMetadata.uploadServer) errors.push("The “uploadServer” parameter appears more than once.");
    for (const name of aliasCollisions) errors.push(`More than one reference uses the file name “${name}”.`);
    const hasDuplicates =
        duplicateMetadata.fileNames.length > 0 ||
        duplicateMetadata.legacyFile ||
        duplicateMetadata.legacySqlFile ||
        duplicateMetadata.title ||
        duplicateMetadata.uploadServer ||
        aliasCollisions.size > 0;
    if (!hasDuplicates) {
        try {
            validateFileReferences(references);
            if (
                references.length > 0 &&
                !references.some(({logicalFilename}) => logicalFilename === "plan.json" || logicalFilename === "plan.xml")
            ) {
                errors.push("No main plan file found. Add file[plan.json] or file[plan.xml].");
            }
        } catch (error) {
            if (error instanceof Error) errors.push(error.message);
        }
    }
    return {errors, hasDuplicates};
}

/** Keep the first raw occurrence of each app-state key and normalized filename, preserving order. */
export function removeDuplicateAppUrlEntries(url: URL): URL {
    const params = new URLSearchParams(url.hash.slice(1));
    const scalarKeys = new Set(["title", "uploadServer", "file", "sql-file"]);
    const seen = new Set<string>();
    const result = new URLSearchParams();
    for (const [key, value] of params) {
        const isNamedFile = key.startsWith("file[") && key.endsWith("]");
        if (scalarKeys.has(key) || isNamedFile) {
            const identity = key === "file" ? "file[plan.json]" : key === "sql-file" ? "file[query.sql]" : key;
            if (seen.has(identity)) continue;
            seen.add(identity);
        }
        // Unknown parameters retain their original values, including repeated values.
        result.append(key, value);
    }
    const next = new URL(url);
    next.search = "";
    const hash = result.toString();
    next.hash = hash ? `#${hash}` : "";
    return next;
}

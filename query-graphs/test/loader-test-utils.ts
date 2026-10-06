import {globSync, readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {loadPlanFromText} from "../src/loaders";
import {formatPropertyValue, getPropertyPath} from "../src/loaders/loader-utils";
import type {TreeNode} from "../src/tree-description";

globalThis.DOMParser = new JSDOM().window.DOMParser;

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const examplesRoot = path.join(repositoryRoot, "standalone-app/examples");
export const fixturePaths = globSync(["**/*.json", "**/*.xml"], {cwd: examplesRoot, exclude: ["index.json"]}).sort();

export function fixturePathsFor(format: string): string[] {
    return fixturePaths.filter((fixturePath) => fixturePath.startsWith(`${format}/`));
}

export function loadFixture(relativePath: string) {
    return loadPlanFromText(readFileSync(path.join(examplesRoot, relativePath), "utf8"));
}

// Read a scalar tooltip property as rendered, following a path into nested property groups.
export function propValue(node: TreeNode | undefined, ...path: string[]): string | undefined {
    const entry = getPropertyPath(node?.properties, path);
    return entry === undefined ? undefined : formatPropertyValue(entry);
}

// Flatten a property group's scalar members, as rendered, into a plain record.
export function propGroup(node: TreeNode | undefined, key: string): Record<string, string> | undefined {
    const entry = node?.properties?.get(key);
    if (entry === undefined || !(entry.value instanceof Map)) return undefined;
    const flattened: Record<string, string> = {};
    for (const [memberKey, memberEntry] of entry.value) {
        const text = formatPropertyValue(memberEntry);
        if (text !== undefined) flattened[memberKey] = text;
    }
    return flattened;
}

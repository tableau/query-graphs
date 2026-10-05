import {globSync, readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {loadPlanFromText} from "../src/loaders";
import type {PropertyEntry, TreeNode} from "../src/tree-description";

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

// Read a scalar tooltip property, following a path into nested property groups.
export function propValue(node: TreeNode | undefined, ...path: string[]): string | undefined {
    let entry: PropertyEntry | undefined = node?.properties?.get(path[0]);
    for (let i = 1; i < path.length; ++i) {
        if (entry === undefined || typeof entry.value === "string") return undefined;
        entry = entry.value.get(path[i]);
    }
    return entry !== undefined && typeof entry.value === "string" ? entry.value : undefined;
}

// Flatten a nested property group's direct scalar members into a plain object.
export function propGroup(node: TreeNode | undefined, key: string): Record<string, string> | undefined {
    const entry = node?.properties?.get(key);
    if (entry === undefined || typeof entry.value === "string") return undefined;
    const flattened: Record<string, string> = {};
    for (const [memberKey, memberEntry] of entry.value) {
        if (typeof memberEntry.value === "string") {
            flattened[memberKey] = memberEntry.value;
        }
    }
    return flattened;
}

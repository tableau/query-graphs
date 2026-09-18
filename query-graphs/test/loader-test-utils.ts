import {globSync, readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {loadPlanFromText} from "../src/loaders";

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

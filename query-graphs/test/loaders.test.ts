import {createHash} from "node:crypto";
import {globSync, readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {JSDOM} from "jsdom";
import {loadHyperPlanFromText} from "../src/loaders/hyper";
import {loadJsonFromText} from "../src/loaders/json";
import {loadPostgresPlanFromText} from "../src/loaders/postgres";
import {loadTableauPlan} from "../src/loaders/tableau";
import {loadXml} from "../src/loaders/xml";
import type {TreeDescription, TreeNode} from "../src/tree-description";
import {allChildren, visitTreeNodes} from "../src/tree-description";

globalThis.DOMParser = new JSDOM().window.DOMParser;

const loaders = {
    postgres: loadPostgresPlanFromText,
    hyper: loadHyperPlanFromText,
    json: loadJsonFromText,
    tableau: loadTableauPlan,
    xml: loadXml,
};

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const examplesRoot = path.join(repositoryRoot, "standalone-app/examples");
const fixturePaths = globSync(["**/*.json", "**/*.xml"], {cwd: examplesRoot, exclude: ["index.json"]}).sort();

function treeDigest(tree: TreeDescription): string {
    const nodeIds = new Map<TreeNode, number>();
    visitTreeNodes(tree.root, (node) => nodeIds.set(node, nodeIds.size), allChildren);

    const crosslinks = tree.crosslinks?.map(({source, target}) => [nodeIds.get(source), nodeIds.get(target)]);
    const json = JSON.stringify({root: tree.root, crosslinks, metadata: tree.metadata}, (_key, value: unknown) => {
        if (value instanceof Map) return Array.from(value);
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
            return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
        }
        return value;
    });
    return createHash("sha256").update(json).digest("hex");
}

test("loader compatibility and output remain stable for every example plan", (t) => {
    function computeDigests(): Record<string, Record<string, string>> {
        const results: Record<string, Record<string, string>> = Object.fromEntries(
            Object.keys(loaders).map((loaderName) => [loaderName, {}]),
        );
        for (const fixturePath of fixturePaths) {
            const text = readFileSync(path.join(examplesRoot, fixturePath), "utf8");
            for (const [loaderName, loader] of Object.entries(loaders)) {
                try {
                    results[loaderName][fixturePath] = treeDigest(loader(text));
                } catch {
                    // This loader rejects the fixture.
                }
            }
        }

        return results;
    }

    try {
        t.assert.fileSnapshot(computeDigests(), fileURLToPath(new URL("./loader-results.json", import.meta.url)));
    } catch {
        throw new Error("Loader results changed. Run `pnpm test:update` to update the expectations, then review the diff.");
    }
});

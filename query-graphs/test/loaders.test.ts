import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {globSync, readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {JSDOM} from "jsdom";
import {
    jsonPlanLoaders,
    loadPlanFromText,
    PlanLoadError,
    PlanSyntaxError,
    UnknownPlanFormatError,
    xmlPlanLoaders,
} from "../src/loaders";
import {parseXml} from "../src/loaders/xml";
import type {TreeDescription, TreeNode} from "../src/tree-description";
import {allChildren, visitTreeNodes} from "../src/tree-description";

globalThis.DOMParser = new JSDOM().window.DOMParser;

const loaders = [
    ...jsonPlanLoaders.map((loader) => ({
        format: loader.format,
        load(text: string) {
            const json = JSON.parse(text);
            if (!loader.matches(json)) throw new Error("Loader did not match");
            return loader.load(json);
        },
    })),
    ...xmlPlanLoaders.map((loader) => ({
        format: loader.format,
        load(text: string) {
            const xml = parseXml(text);
            if (!loader.matches(xml)) throw new Error("Loader did not match");
            return loader.load(xml);
        },
    })),
];

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const examplesRoot = path.join(repositoryRoot, "standalone-app/examples");
const fixturePaths = globSync(["**/*.json", "**/*.xml"], {cwd: examplesRoot, exclude: ["index.json"]}).sort();

function loadFixture(relativePath: string) {
    return loadPlanFromText(readFileSync(path.join(examplesRoot, relativePath), "utf8"));
}

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
        const results: Record<string, Record<string, string>> = Object.fromEntries(loaders.map((loader) => [loader.format, {}]));
        for (const fixturePath of fixturePaths) {
            const text = readFileSync(path.join(examplesRoot, fixturePath), "utf8");
            for (const loader of loaders) {
                try {
                    results[loader.format][fixturePath] = treeDigest(loader.load(text));
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

test("dispatcher recognizes the Postgres and Hyper examples", () => {
    for (const format of ["postgres", "hyper"] as const) {
        for (const fixturePath of fixturePaths.filter((path) => path.startsWith(`${format}/`))) {
            assert.equal(loadFixture(fixturePath).format, format, fixturePath);
        }
    }
});

test("dispatcher falls back to the generic JSON loader", () => {
    for (const json of ['{"unrecognized":{"value":42}}', '[{"name":"Alice","children":[]}]', '{"operator":{}}']) {
        assert.equal(loadPlanFromText(json).format, "json", json);
    }
});

test("dispatcher accepts the sql_hyper output prefix", () => {
    const fixture = readFileSync(path.join(examplesRoot, "hyper/tablescan-analyze.plan.json"), "utf8");
    assert.equal(loadPlanFromText(`plan\n${fixture}`).format, "hyper");
});

test("dispatcher distinguishes syntax and recognized-format failures", () => {
    assert.throws(() => loadPlanFromText("not JSON or XML"), PlanSyntaxError);
    assert.throws(
        () => loadPlanFromText('{"Plan":{}}'),
        (error: unknown) => error instanceof PlanLoadError && error.format === "postgres",
    );
});

test("dispatcher recognizes Tableau XML and falls back to generic XML", () => {
    assert.equal(loadPlanFromText("<logical-query />").format, "tableau");
    assert.equal(loadPlanFromText("<unrecognized />").format, "xml");
});

test("dispatcher can force a registered loader", () => {
    const hyper = readFileSync(path.join(examplesRoot, "hyper/tablescan-analyze.plan.json"), "utf8");
    assert.equal(loadPlanFromText(hyper, {format: "hyper"}).format, "hyper");
    assert.equal(loadPlanFromText(hyper, {format: "json"}).format, "json");
    assert.equal(loadPlanFromText(hyper, {format: "json"}).tree.root.name, "root");

    assert.equal(loadPlanFromText('{"operator":{}}', {format: "hyper"}).format, "hyper");
    assert.throws(
        () => loadPlanFromText("{}", {format: "xml"}),
        (error: unknown) => error instanceof PlanSyntaxError && error.expectedSyntax === "xml" && error.format === "xml",
    );
    assert.throws(
        () => loadPlanFromText("{}", {format: "unknown"}),
        (error: unknown) => error instanceof UnknownPlanFormatError && error.format === "unknown",
    );
});

import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {globSync, readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {JSDOM} from "jsdom";
import {InvalidPlanError, jsonPlanLoaders, loadPlanFromText, UnknownPlanFormatError, xmlPlanLoaders} from "../src/loaders";
import type {TreeDescription, TreeNode} from "../src/tree-description";
import {allChildren, visitTreeNodes} from "../src/tree-description";

globalThis.DOMParser = new JSDOM().window.DOMParser;

const loaderFormats = [...jsonPlanLoaders, ...xmlPlanLoaders].map((loader) => loader.format);

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
        const results: Record<string, Record<string, string>> = Object.fromEntries(loaderFormats.map((format) => [format, {}]));
        for (const fixturePath of fixturePaths) {
            const text = readFileSync(path.join(examplesRoot, fixturePath), "utf8");
            for (const format of loaderFormats) {
                try {
                    results[format][fixturePath] = treeDigest(loadPlanFromText(text, {format}).tree);
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

test("Postgres decorates the shared JSON tree with plan-specific semantics", () => {
    const text = JSON.stringify({
        Plan: {
            "Node Type": "Append",
            Plans: [
                {"Node Type": "Aggregate", "Subplan Name": "CTE cte", "Plan Rows": 1, "Actual Rows": 100},
                {"Node Type": "CTE Scan", "CTE Name": "cte", Workers: [{Number: 0}]},
            ],
        },
    });
    const tree = loadPlanFromText(text, {format: "postgres"}).tree;
    const append = tree.root.children?.[0];
    const aggregate = append?.children?.[0];
    const cteScan = append?.children?.[1];
    const workers = cteScan?.collapsedChildren?.[0];

    assert.equal(aggregate?.edgeClass, "qg-label-highlighted");
    assert.equal(workers?.name, "Workers");
    assert.deepEqual(
        workers?.children?.map((node) => node.name),
        ["Workers.0"],
    );
    assert.equal(workers?.collapsedChildren, undefined);
    assert.deepEqual(tree.crosslinks, [{source: cteScan, target: aggregate}]);
});

test("dispatcher falls back to the generic JSON loader", () => {
    for (const json of ['{"unrecognized":{"value":42}}', '[{"name":"Alice","children":[]}]', '{"operator":{}}']) {
        assert.equal(loadPlanFromText(json).format, "json", json);
    }

    // Without format-specific decorations, every nested object and array stays visible; no node is collapsed.
    const tree = loadPlanFromText('{"nested":{"value":42},"items":[{"value":1}]}').tree;
    visitTreeNodes(tree.root, (node) => assert.equal(node.collapsedChildren?.length ?? 0, 0), allChildren);
});

test("dispatcher strips text surrounding copied plans", () => {
    const json = 'Copied from the query analyzer:\n{"unrecognized":true}\nEnd of plan';
    assert.equal(loadPlanFromText(json).format, "json");
    assert.equal(loadPlanFromText(json, {format: "json"}).format, "json");

    const xml = "Copied from the query analyzer:\n<logical-query />\nEnd of plan";
    assert.equal(loadPlanFromText(xml).format, "tableau");
    assert.equal(loadPlanFromText(xml, {format: "xml"}).format, "xml");
});

test("dispatcher reports invalid plans", () => {
    assert.throws(() => loadPlanFromText("not JSON or XML"), InvalidPlanError);
    assert.throws(
        () => loadPlanFromText('{"Plan":{}}', {format: "postgres"}),
        (error: unknown) => error instanceof InvalidPlanError && error.format === "postgres",
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
    assert.equal(loadPlanFromText('[{"operator":"scan"}]', {format: "hyper"}).tree.root.name, "result");
    assert.throws(
        () => loadPlanFromText("{}", {format: "xml"}),
        (error: unknown) => error instanceof InvalidPlanError && error.format === "xml",
    );
    assert.throws(
        () => loadPlanFromText("{}", {format: "unknown"}),
        (error: unknown) => error instanceof UnknownPlanFormatError && error.format === "unknown",
    );
});

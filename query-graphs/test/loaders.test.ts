import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {InvalidPlanError, jsonPlanLoaders, loadPlanFromText, UnknownPlanFormatError, xmlPlanLoaders} from "../src/loaders";
import type {TreeDescription, TreeNode} from "../src/tree-description";
import {allChildren, visitTreeNodes} from "../src/tree-description";
import {examplesRoot, fixturePaths} from "./loader-test-utils";

const loaderFormats = [...jsonPlanLoaders, ...xmlPlanLoaders].map((loader) => loader.format);

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
    const hyper = '{"operator":"scan"}';
    const postgres = '{"Plan":{"Node Type":"Result"}}';

    assert.equal(loadPlanFromText(hyper, {format: "hyper"}).format, "hyper");
    assert.equal(loadPlanFromText(postgres, {format: "postgres"}).format, "postgres");
    assert.equal(loadPlanFromText(hyper, {format: "json"}).format, "json");
    assert.equal(loadPlanFromText(postgres, {format: "json"}).format, "json");
    assert.equal(loadPlanFromText('{"unrecognized":true}', {format: "json"}).format, "json");
    assert.equal(loadPlanFromText("<unrecognized />", {format: "xml"}).format, "xml");
    assert.throws(
        () => loadPlanFromText("{}", {format: "xml"}),
        (error: unknown) => error instanceof InvalidPlanError && error.format === "xml",
    );
    assert.throws(
        () => loadPlanFromText("{}", {format: "unknown"}),
        (error: unknown) => error instanceof UnknownPlanFormatError && error.format === "unknown",
    );
});

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

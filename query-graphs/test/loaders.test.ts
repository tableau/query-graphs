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
        if (_key === "sourceLocations") return undefined;
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
    const loadedJson = loadPlanFromText(json);
    assert.equal(loadedJson.format, "json");
    assert.deepEqual(loadedJson.tree.textDocuments, [
        {id: "plan", title: "Query Plan", text: '{\n   "unrecognized": true\n}', language: "json"},
    ]);
    assert.equal(loadPlanFromText(json, {format: "json"}).format, "json");

    const xml = "Copied from the query analyzer:\n<logical-query />\nEnd of plan";
    const loadedXml = loadPlanFromText(xml);
    assert.equal(loadedXml.format, "tableau");
    assert.deepEqual(loadedXml.tree.textDocuments, [{id: "plan", title: "Query Plan", text: "<logical-query />", language: "xml"}]);
    assert.equal(loadPlanFromText(xml, {format: "xml"}).format, "xml");
});

test("dispatcher pretty-prints single-line JSON documents with three-space indentation", () => {
    const json = '{"nested":{"value":42},"items":[1,2]}';
    const document = loadPlanFromText(json).tree.textDocuments?.find(({id}) => id === "plan");
    assert.equal(document?.text, '{\n   "nested": {\n      "value": 42\n   },\n   "items": [\n      1,\n      2\n   ]\n}');
});

test("dispatcher pretty-prints JSON without changing its tokens", () => {
    const json = '{"2":"first","value":9007199254740993,"value":1e400,"1":"last","text":"{},:[ before \\"quote\\" after"}';
    const document = loadPlanFromText(json).tree.textDocuments?.find(({id}) => id === "plan");
    assert.equal(
        document?.text,
        '{\n   "2": "first",\n   "value": 9007199254740993,\n   "value": 1e400,\n   "1": "last",\n   "text": "{},:[ before \\"quote\\" after"\n}',
    );
});

test("dispatcher preserves multiline JSON formatting while normalizing line endings", () => {
    const examples = [
        {json: '{\n "unrecognized": true\n}', expected: '{\n "unrecognized": true\n}'},
        {json: '{\r\n\t"unrecognized": true\r\n}', expected: '{\n\t"unrecognized": true\n}'},
        {json: '{\r "unrecognized": true\r}', expected: '{\n "unrecognized": true\n}'},
    ];
    for (const {json, expected} of examples) {
        const document = loadPlanFromText(json).tree.textDocuments?.find(({id}) => id === "plan");
        assert.equal(document?.text, expected);
    }
});

test("JSON plan documents and their source offsets use canonical line endings", () => {
    const loaded = loadPlanFromText('{\r\n  "operator": "scan"\r\n}', {format: "hyper"});
    const document = loaded.tree.textDocuments?.find(({id}) => id === "plan");
    assert.equal(document?.text, '{\n  "operator": "scan"\n}');
    const from = document?.text.indexOf('"scan"') ?? -1;
    assert.deepEqual(loaded.tree.root.sourceLocations, [{documentId: "plan", from, to: from + '"scan"'.length}]);
});

test("JSON loaders retain source locations for semantic node names", () => {
    const examples = [
        {text: '{"operator": "scan"}', format: "hyper", name: "scan", token: '"scan"'},
        {
            text: '{"tree": {"operator": "scan"}, "pipelines": []}',
            format: "hyper",
            name: "scan",
            token: '"scan"',
        },
        {
            text: '{"optimizersteps": [{"name": "step", "plan": {"operator": "scan"}}]}',
            format: "hyper",
            name: "scan",
            token: '"scan"',
        },
        {
            text: '{"plan": {"operator": "scan", "operatorId": 1}}',
            format: "umbra",
            name: "scan",
            token: '"scan"',
        },
        {
            text: '{"optimized": {"plan": {"operator": "scan", "operatorId": 1}}}',
            format: "umbra",
            name: "scan",
            token: '"scan"',
        },
        {text: '{"Plan": {"Node Type": "Result"}}', format: "postgres", name: "Result", token: '"Result"'},
        {text: '[{"Plan": {"Node Type": "Result"}}]', format: "postgres", name: "Result", token: '"Result"'},
        {
            text: '[{"name": "SEQ_SCAN", "children": [], "extra_info": {}}]',
            format: "duckdb",
            name: "seq_scan",
            token: '"SEQ_SCAN"',
        },
        {
            text: '{"logical_plan": [{"name": "SEQ_SCAN", "children": [], "extra_info": {}}]}',
            format: "duckdb",
            name: "seq_scan",
            token: '"SEQ_SCAN"',
        },
        {
            text: '{"query_name": "select 1", "children": [{"operator_name": "SEQ_SCAN", "children": [], "extra_info": {}}]}',
            format: "duckdb",
            name: "seq_scan",
            token: '"SEQ_SCAN"',
        },
        {text: '{"name": "root", "value": 1}', format: "json", name: "root", token: '"root"'},
    ];

    for (const example of examples) {
        const loaded = loadPlanFromText(example.text, {format: example.format});
        let matchingNode: TreeNode | undefined;
        visitTreeNodes(
            loaded.tree.root,
            (node) => {
                if (node.name === example.name) matchingNode = node;
            },
            allChildren,
        );
        const document = loaded.tree.textDocuments?.find(({id}) => id === "plan");
        const from = document?.text.indexOf(example.token) ?? -1;
        assert.deepEqual(matchingNode?.sourceLocations, [{documentId: "plan", from, to: from + example.token.length}]);
    }
});

test("low-level loaders remain usable without source text", () => {
    const tree = jsonPlanLoaders.find(({format}) => format === "hyper")?.load({operator: "scan"});
    assert.equal(tree?.root.name, "scan");
    assert.equal(tree?.root.sourceLocations, undefined);
});

test("DuckDB source locations follow the operator-name fallback", () => {
    const text = '[{"operator_name": null, "name": "SEQ_SCAN", "children": [], "extra_info": {}}]';
    const loaded = loadPlanFromText(text, {format: "duckdb"});
    const root = loaded.tree.root;
    const document = loaded.tree.textDocuments?.find(({id}) => id === "plan");
    const from = document?.text.indexOf('"SEQ_SCAN"') ?? -1;
    assert.equal(root.name, "seq_scan");
    assert.deepEqual(root.sourceLocations, [{documentId: "plan", from, to: from + '"SEQ_SCAN"'.length}]);
});

test("dispatcher reports invalid plans", () => {
    assert.throws(() => loadPlanFromText("not JSON or XML"), InvalidPlanError);
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

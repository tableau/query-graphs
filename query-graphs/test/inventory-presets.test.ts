import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {JSDOM} from "jsdom";
import type {TreeNode} from "../src/tree-description";
import {computeCategoricalInsight} from "../src/insights/categorical";
import {insightPresets} from "../src/insights/presets";
import {loadPlanFromText} from "../src/loaders";

const examples = [
    ["hyper", "hyper/tablescan-analyze.plan.json", "scan", "region"],
    ["umbra", "umbra/tablescan-analyze.plan.json", "tablescan", "region"],
    ["umbra", "cedardb/tablescan-analyze.plan.json", "tablescan", "region"],
    ["postgres", "postgres/tablescan-analyze.plan.json", "Seq Scan", "region"],
    ["duckdb", "duckdb/tablescan-analyze.plan.json", "TABLE_SCAN", '"temp".main.region'],
    ["duckdb", "duckdb/unicode.plan.json", "SEQ_SCAN", '"temp".main.region'],
] as const;

for (const [format, file, scanType, tableName] of examples) {
    test(`${file} has a configured inventory`, () => {
        const dom = new JSDOM();
        const previousParser = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
        Object.defineProperty(globalThis, "DOMParser", {configurable: true, value: dom.window.DOMParser});
        try {
            const text = readFileSync(new URL(`../../standalone-app/examples/${file}`, import.meta.url), "utf8");
            const loaded = loadPlanFromText(text);
            assert.equal(loaded.format, format);
            const preset = insightPresets[loaded.format];
            assert.ok(preset.length > 0);
            const scannedTables = computeCategoricalInsight(
                loaded.tree.root,
                preset.find(({id}) => id === "table-names")!,
            );
            assert.ok(scannedTables.some(({value}) => value === tableName));
            const operators = computeCategoricalInsight(
                loaded.tree.root,
                preset.find(({id}) => id === "operators")!,
            );
            const scan = operators.find(({value}) => value === scanType);
            const tableCategories =
                format === "hyper" ? scan?.children.find(({value}) => value === "native")?.children : scan?.children;
            assert.ok(tableCategories?.some(({value}) => value === tableName));
        } finally {
            if (previousParser) Object.defineProperty(globalThis, "DOMParser", previousParser);
            else Reflect.deleteProperty(globalThis, "DOMParser");
            dom.window.close();
        }
    });
}

for (const engine of ["umbra", "cedardb"]) {
    test(`${engine} inventory groups set operations and comparisons by subtype`, () => {
        const dom = new JSDOM();
        const previousParser = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
        Object.defineProperty(globalThis, "DOMParser", {configurable: true, value: dom.window.DOMParser});
        try {
            const loadExample = (file: string) =>
                loadPlanFromText(readFileSync(new URL(`../../standalone-app/examples/${engine}/${file}`, import.meta.url), "utf8"));
            const setOperations = computeCategoricalInsight(
                loadExample("setoperation-analyze.plan.json").tree.root,
                insightPresets.umbra.find(({id}) => id === "operators")!,
            ).find(({value}) => value === "setoperation");
            assert.ok(setOperations?.children.some(({value}) => value === "unionall"));

            const comparisons = computeCategoricalInsight(
                loadExample("magicunnesting-analyze.plan.json").tree.root,
                insightPresets.umbra.find(({id}) => id === "expressions")!,
            ).find(({value}) => value === "compare");
            assert.ok(comparisons?.children.some(({value}) => value === "="));
        } finally {
            if (previousParser) Object.defineProperty(globalThis, "DOMParser", previousParser);
            else Reflect.deleteProperty(globalThis, "DOMParser");
            dom.window.close();
        }
    });
}

test("additional Postgres and DuckDB scan variants drill down to table names", () => {
    for (const [format, properties, scanType] of [
        [
            "postgres",
            [
                ["Node Type", "Index Only Scan"],
                ["Relation Name", "orders"],
            ],
            "Index Only Scan",
        ],
        [
            "duckdb",
            [
                ["name", "SEQ_SCAN"],
                ["Table", "orders"],
            ],
            "SEQ_SCAN",
        ],
    ] as const) {
        const node: TreeNode = {properties: new Map(properties)};
        const definitions = insightPresets[format];
        const scanned = computeCategoricalInsight(
            node,
            definitions.find(({id}) => id === "table-names")!,
        );
        const operators = computeCategoricalInsight(
            node,
            definitions.find(({id}) => id === "operators")!,
        );
        assert.equal(scanned[0].value, "orders");
        assert.equal(operators.find(({value}) => value === scanType)?.children[0]?.value, "orders");
    }
});

import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import type {TreeNode} from "../src/tree-description";
import {
    computeCategoricalInsight,
    type CategoricalInsightCategory,
    type CategoricalInsightDefinition,
} from "../src/insights/categorical";
import {insightPresets} from "../src/insights/presets";
import {loadPlanFromText} from "../src/loaders";

function dumpInsights(root: TreeNode, definitions: readonly CategoricalInsightDefinition[]): string {
    const lines = definitions.flatMap((definition) => {
        const categories = computeCategoricalInsight(root, definition);
        const count = categories.reduce((sum, category) => sum + category.nodes.length, 0);
        const rows = (items: readonly CategoricalInsightCategory[], depth: number): string[] =>
            items.flatMap((category) => [
                `${"  ".repeat(depth)}- ${category.value}: ${category.nodes.length}`,
                ...rows(category.children, depth + 1),
            ]);
        return [`${definition.title}: ${count}`, ...rows(categories, 1), ""];
    });
    return lines.join("\n");
}

const examples = [
    // Hyper Q2 covers native scans with table names, join types, and comparison expression modes.
    {name: "hyper-tpch-q2", plan: "standalone-app/examples/hyper/tpch/tpch-q2-analyze.plan.json", format: "hyper"},
    // Umbra Q2 covers scans, join types, and comparison directions in its operator and expression trees.
    {name: "umbra-tpch-q2", plan: "standalone-app/examples/umbra/tpch/tpch-q2-analyze.plan.json", format: "umbra"},
    // CedarDB Q2 checks that CedarDB plans use the same Umbra insight definitions.
    {name: "cedardb-tpch-q2", plan: "standalone-app/examples/cedardb/tpch/tpch-q2-analyze.plan.json", format: "umbra"},
    // Postgres Q2 covers Seq Scan relation names and its remaining operator categories.
    {name: "postgres-tpch-q2", plan: "standalone-app/examples/postgres/tpch/tpch-q2-analyze.plan.json", format: "postgres"},
    // DuckDB Q2 covers the analyzed TABLE_SCAN spelling and fully qualified table names.
    {name: "duckdb-tpch-q2", plan: "standalone-app/examples/duckdb/tpch/tpch-q2-analyze.plan.json", format: "duckdb"},
    // Umbra set operations cover union, intersect, and except subtype drilldown absent from Q2.
    {name: "umbra-setoperation", plan: "standalone-app/examples/umbra/setoperation-analyze.plan.json", format: "umbra"},
    // CedarDB set operations cover the same subtypes through the shared Umbra definitions.
    {name: "cedardb-setoperation", plan: "standalone-app/examples/cedardb/setoperation-analyze.plan.json", format: "umbra"},
    // This catalog query exercises Postgres Index Scan instead of Q2's Seq Scan.
    {name: "postgres-index-scan", plan: "standalone-app/examples/postgres/metadata-describe-table.plan.json", format: "postgres"},
    // DuckDB's Unicode example uses SEQ_SCAN instead of the analyzed TABLE_SCAN spelling.
    {name: "duckdb-seq-scan", plan: "standalone-app/examples/duckdb/unicode.plan.json", format: "duckdb"},
] as const;

for (const {name, plan, format} of examples) {
    test(`${name} insights match their golden file`, () => {
        const text = readFileSync(new URL(`../../${plan}`, import.meta.url), "utf8");
        const loaded = loadPlanFromText(text);
        assert.equal(loaded.format, format);
        // Compare every configured insight, including category order, nesting, and occurrence counts.
        assert.equal(
            dumpInsights(loaded.tree.root, insightPresets[format]),
            readFileSync(new URL(`./insights-${name}.txt`, import.meta.url), "utf8"),
        );
    });
}

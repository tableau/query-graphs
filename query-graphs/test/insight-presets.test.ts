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

function dumpInventory(root: TreeNode, definitions: readonly CategoricalInsightDefinition[]): string {
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

// A representative analyzed plan covers every configured insight, category order, depth, and count for each engine.
for (const [engine, format] of [
    ["hyper", "hyper"],
    ["umbra", "umbra"],
    ["cedardb", "umbra"],
    ["postgres", "postgres"],
    ["duckdb", "duckdb"],
] as const) {
    test(`${engine} TPC-H Q2 inventory matches its golden file`, () => {
        const text = readFileSync(
            new URL(`../../standalone-app/examples/${engine}/tpch/tpch-q2-analyze.plan.json`, import.meta.url),
            "utf8",
        );
        const loaded = loadPlanFromText(text);
        // CedarDB plans use Umbra's loader and inventory definition.
        assert.equal(loaded.format, format);
        // Compare all configured insights, including every nested value and count, with a readable baseline.
        assert.equal(
            dumpInventory(loaded.tree.root, insightPresets[format]),
            readFileSync(new URL(`./inventory-${engine}-tpch-q2.txt`, import.meta.url), "utf8"),
        );
    });
}

for (const engine of ["umbra", "cedardb"]) {
    test(`${engine} inventory groups set operations and comparisons by subtype`, () => {
        const loadExample = (file: string) =>
            loadPlanFromText(readFileSync(new URL(`../../standalone-app/examples/${engine}/${file}`, import.meta.url), "utf8"));
        const setOperations = computeCategoricalInsight(
            loadExample("setoperation-analyze.plan.json").tree.root,
            insightPresets.umbra.find(({id}) => id === "operators")!,
        ).find(({value}) => value === "setoperation");
        // Both engines use the Umbra preset and keep operation semantics as the second level.
        assert.ok(setOperations?.children.some(({value}) => value === "unionall"));

        const comparisons = computeCategoricalInsight(
            loadExample("magicunnesting-analyze.plan.json").tree.root,
            insightPresets.umbra.find(({id}) => id === "expressions")!,
        ).find(({value}) => value === "compare");
        // Comparison expressions likewise drill into their comparison operator.
        assert.ok(comparisons?.children.some(({value}) => value === "="));
    });
}

test("additional Postgres and DuckDB scan variants drill down to table names", () => {
    // Exercise scan spellings absent from the shared example plans without adding full fixtures.
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
        // The same relation appears in the flat insight and beneath its engine-specific scan type.
        assert.equal(scanned[0].value, "orders");
        assert.equal(operators.find(({value}) => value === scanType)?.children[0]?.value, "orders");
    }
});

const node = (properties: Record<string, string>): TreeNode => ({properties: new Map(Object.entries(properties))});

function assertAdditive(categories: readonly CategoricalInsightCategory[]) {
    // Every deeper level partitions the same occurrences as its parent, rather than recounting nodes.
    for (const category of categories) {
        if (category.children.length) {
            assert.equal(
                category.nodes.length,
                category.children.reduce((sum, child) => sum + child.nodes.length, 0),
            );
            assert.deepEqual(new Set(category.nodes), new Set(category.children.flatMap((child) => child.nodes)));
            assertAdditive(category.children);
        }
    }
}

test("Hyper inventory includes hidden occurrences, missing values, and unfamiliar tags with additive counts", () => {
    const native = node({operator: "scan", type: "native", "debug-name": '{"value":"t1"}'});
    const hiddenNative = node({operator: "scan", type: "native", "debug-name": '{"value":"t1"}'});
    const root: TreeNode = {
        ...node({operator: "join", type: "inner"}),
        children: [native, node({operator: "scan", type: "native", "debug-name": '{"value":"t2"}'})],
        collapsedChildren: [
            hiddenNative,
            node({operator: "scan"}),
            node({operator: "future-operator"}),
            node({operator: "union-all"}),
            node({operator: "intersect-all"}),
            node({operator: "join"}),
        ],
    };
    const groups = computeCategoricalInsight(
        root,
        insightPresets.hyper.find(({id}) => id === "operators")!,
    );
    // Visible and collapsed occurrences count equally, including new operator tags unknown to this preset.
    assert.equal(
        groups.reduce((sum, category) => sum + category.nodes.length, 0),
        9,
    );
    assert.deepEqual(
        groups.map((category) => category.value),
        ["scan", "join", "future-operator", "intersect-all", "union-all"],
    );
    const scans = groups[0];
    // Only scan operators drill into storage type, then table name; missing fields use explicit fallbacks.
    assert.deepEqual(
        scans.children.map((category) => category.value),
        ["native", "Unknown storage"],
    );
    assert.deepEqual(
        scans.children[0].children.map((category) => category.value),
        ["t1", "t2"],
    );
    assert.equal(scans.children[1].children[0].value, "Unknown table");
    assertAdditive(groups);
});

test("Hyper expressions group comparisons by mode without expanding IU references or result datatypes", () => {
    const root: TreeNode = {
        children: [
            node({expression: "iu-ref", iu: "a"}),
            node({expression: "iu-ref", iu: "b"}),
            node({expression: "comparison", mode: "="}),
            node({expression: "comparison"}),
            node({expression: "future-expression", type: "integer"}),
        ],
    };
    const groups = computeCategoricalInsight(
        root,
        insightPresets.hyper.find(({id}) => id === "expressions")!,
    );
    assertAdditive(groups);
    // IU names and result types are intentionally not inventory levels in this version.
    assert.equal(groups.find((category) => category.value === "iu-ref")?.children.length, 0);
    assert.equal(groups.find((category) => category.value === "future-expression")?.children.length, 0);
    assert.deepEqual(
        groups.find((category) => category.value === "comparison")?.children.map((child) => child.value),
        ["=", "Unknown comparison"],
    );
});

test("Hyper external scans use the schema table-name ahead of debug names", () => {
    const scan = node({operator: "scan", type: "iceberg", "table-name": "public.orders", "debug-name": '{"value":"debug alias"}'});
    const groups = computeCategoricalInsight(
        scan,
        insightPresets.hyper.find(({id}) => id === "operators")!,
    );
    // The external scan's schema table-name takes precedence over its debug alias.
    assert.equal(groups[0].children[0].children[0].value, "public.orders");
    assertAdditive(groups);
});

test("unfamiliar operator tags remain visible even when they match object method names", () => {
    const groups = computeCategoricalInsight(
        node({operator: "toString"}),
        insightPresets.hyper.find(({id}) => id === "operators")!,
    );
    // The label is data, so a name inherited from Object.prototype must remain a category.
    assert.equal(groups[0].value, "toString");
    assert.equal(groups[0].children.length, 0);
});

test("table name insight groups Hyper scans across collapsed subtrees with name fallbacks", () => {
    const scan = (properties: [string, string][] = []): TreeNode => ({
        properties: new Map([["operator", "scan"], ...properties]),
    });
    const native = scan([["debug-name", '{"value":"region"}']]);
    const virtual = scan([
        ["table-name", "warehouse"],
        ["debug-name", '{"value":"ignored"}'],
    ]);
    const root: TreeNode = {
        properties: new Map([
            ["operator", "join"],
            ["table-name", "not-a-scan"],
        ]),
        children: [native],
        collapsedChildren: [
            {
                properties: new Map([
                    ["operator", "filter"],
                    ["table-name", "not-a-scan"],
                ]),
            },
            virtual,
            scan([["debug-name", '{"value":"region"}']]),
            scan(),
        ],
    };

    // Non-scans are excluded; repeated names combine across collapsed and visible subtrees.
    // For external scans, table-name wins over debug-name, and unnamed scans keep a fallback row.
    assert.deepEqual(
        computeCategoricalInsight(
            root,
            insightPresets.hyper.find(({id}) => id === "table-names")!,
        ),
        [
            {value: "region", nodes: [native, root.collapsedChildren?.[2]], children: []},
            {value: "Unknown table", nodes: [root.collapsedChildren?.[3]], children: []},
            {value: "warehouse", nodes: [virtual], children: []},
        ],
    );
});

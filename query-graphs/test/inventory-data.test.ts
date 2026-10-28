import assert from "node:assert/strict";
import test from "node:test";
import type {TreeNode} from "../src/tree-description";
import {computeCategoricalInsight, type CategoricalInsightCategory} from "../src/insights/categorical";
import {insightPresets} from "../src/insights/presets";

const node = (properties: Record<string, string>): TreeNode => ({properties: new Map(Object.entries(properties))});

function assertAdditive(categories: readonly CategoricalInsightCategory[]) {
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
    const root: TreeNode = {
        ...node({operator: "join", type: "inner"}),
        children: [native, node({operator: "scan", type: "native", "debug-name": '{"value":"t2"}'})],
        collapsedChildren: [
            native,
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
    assert.equal(
        groups.reduce((sum, category) => sum + category.nodes.length, 0),
        8,
    );
    assert.deepEqual(
        groups.map((category) => category.value),
        ["scan", "join", "future-operator", "intersect-all", "union-all"],
    );
    const scans = groups[0];
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
    assert.equal(groups[0].children[0].children[0].value, "public.orders");
    assertAdditive(groups);
});

test("unfamiliar operator tags remain visible even when they match object method names", () => {
    const groups = computeCategoricalInsight(
        node({operator: "toString"}),
        insightPresets.hyper.find(({id}) => id === "operators")!,
    );
    assert.equal(groups[0].value, "toString");
    assert.equal(groups[0].children.length, 0);
});

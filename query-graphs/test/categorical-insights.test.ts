import assert from "node:assert/strict";
import test from "node:test";
import type {TreeNode} from "../src/tree-description";
import {computeCategoricalInsight} from "../src/insights/categorical";
import {insightPresets} from "../src/insights/presets";

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

    assert.deepEqual(
        computeCategoricalInsight(
            root,
            insightPresets.hyper.insights.find(({id}) => id === "table-names")!,
        ),
        [
            {value: "region", nodes: [native, root.collapsedChildren?.[2]], children: []},
            {value: "Unknown table", nodes: [root.collapsedChildren?.[3]], children: []},
            {value: "warehouse", nodes: [virtual], children: []},
        ],
    );
});

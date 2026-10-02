import assert from "node:assert/strict";
import test from "node:test";
import type {TreeNode} from "../src/tree-description";
import {computeCategoricalInsight} from "../src/insights/categorical";
import {insightPresets} from "../src/insights/presets";

test("scan type insight groups current Hyper scans across collapsed subtrees", () => {
    const scan = (type?: string): TreeNode => ({
        properties: new Map([["operator", "scan"], ...(type === undefined ? [] : [["type", type]])]),
    });
    const native = scan("native");
    const virtual = scan("virtual-table");
    const root: TreeNode = {
        properties: new Map([
            ["operator", "join"],
            ["type", "native"],
        ]),
        children: [native],
        collapsedChildren: [
            {
                properties: new Map([
                    ["operator", "filter"],
                    ["type", "native"],
                ]),
            },
            virtual,
            scan("native"),
            scan(),
        ],
    };

    assert.deepEqual(computeCategoricalInsight(root, insightPresets.hyper[0]), [
        {value: "native", nodes: [native, root.collapsedChildren?.[2]]},
        {value: "virtual-table", nodes: [virtual]},
    ]);
});

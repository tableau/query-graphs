import assert from "node:assert/strict";
import test from "node:test";
import type {TreeNode} from "../src/tree-description";
import {computeCategoricalInsight} from "../src/insights/categorical";
import {insightPresets} from "../src/insights/presets";

test("scan type insight groups current Hyper scans across collapsed subtrees", () => {
    const scan = (type?: string): TreeNode => ({
        properties: new Map([["operator", {value: "scan"}], ...(type === undefined ? [] : [["type", {value: type}]])]),
    });
    const native = scan("native");
    const virtual = scan("virtual-table");
    const root: TreeNode = {
        properties: new Map([
            ["operator", {value: "join"}],
            ["type", {value: "native"}],
        ]),
        children: [native],
        collapsedChildren: [
            {
                properties: new Map([
                    ["operator", {value: "filter"}],
                    ["type", {value: "native"}],
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

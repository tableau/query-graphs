import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import type {TreeDescription, TreeNode} from "../src/tree-description";
import {allChildren} from "../src/tree-description";
import {loadPlanFromTextWithFormat} from "../src/loaders/plan";

interface ExampleIndex {
    engines: Record<
        string,
        {
            queries: Record<string, Record<string, string>>;
        }
    >;
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const examplesRoot = path.join(repositoryRoot, "standalone-app/examples");
const exampleIndex = JSON.parse(readFileSync(path.join(examplesRoot, "index.json"), "utf8")) as ExampleIndex;

function fixturePaths(engine: string): string[] {
    return Object.values(exampleIndex.engines[engine].queries)
        .flatMap((modes) => Object.values(modes))
        .sort();
}

function loadFixture(relativePath: string) {
    return loadPlanFromTextWithFormat(readFileSync(path.join(examplesRoot, relativePath), "utf8"));
}

function treeNodes(root: TreeNode): TreeNode[] {
    return [root, ...allChildren(root).flatMap(treeNodes)];
}

function treeDigest(tree: TreeDescription): string {
    const nodeIds = new Map<TreeNode, number>();
    let nextNodeId = 0;

    function canonicalizeNode(node: TreeNode): unknown {
        const id = nextNodeId++;
        nodeIds.set(node, id);
        return {
            id,
            name: node.name,
            nodeColor: node.nodeColor,
            icon: node.icon,
            iconColor: node.iconColor,
            properties: node.properties === undefined ? undefined : Array.from(node.properties),
            barsAbove: node.barsAbove,
            barsBelow: node.barsBelow,
            edgeClass: node.edgeClass,
            edgeLabel: node.edgeLabel,
            edgeWidth: node.edgeWidth,
            edgeColors: node.edgeColors,
            children: node.children?.map(canonicalizeNode),
            collapsedChildren: node.collapsedChildren?.map(canonicalizeNode),
            expandedByDefault: node.expandedByDefault,
        };
    }

    const root = canonicalizeNode(tree.root);
    const crosslinks = tree.crosslinks?.map(({source, target}) => [nodeIds.get(source), nodeIds.get(target)]);
    const metadata = tree.metadata === undefined ? undefined : Array.from(tree.metadata);
    return createHash("sha256").update(JSON.stringify({root, crosslinks, metadata})).digest("hex");
}

test("detects all existing Postgres and Hyper examples", () => {
    for (const format of ["postgres", "hyper"] as const) {
        for (const fixturePath of fixturePaths(format)) {
            assert.equal(loadFixture(fixturePath).format, format, fixturePath);
        }
    }
});

test("unrecognized JSON uses the generic loader", () => {
    const loaded = loadPlanFromTextWithFormat('{"unrecognized": {"value": 42}}');
    assert.equal(loaded.format, "json");
    assert.equal(loaded.tree.root.name, "root");

    assert.equal(loadPlanFromTextWithFormat('[{"name":"Alice","children":[]}]').format, "json");
    assert.equal(loadPlanFromTextWithFormat('{"steps":[]}').format, "json");
});

test("dispatch preserves the sql_hyper output prefix", () => {
    const fixture = readFileSync(path.join(examplesRoot, "hyper/tablescan-analyze.plan.json"), "utf8");
    assert.equal(loadPlanFromTextWithFormat(`plan\n${fixture}`).format, "hyper");
});

test("loads every Umbra and CedarDB example semantically", () => {
    for (const engine of ["umbra", "cedardb"]) {
        for (const fixturePath of fixturePaths(engine)) {
            const loaded = loadFixture(fixturePath);
            assert.equal(loaded.format, "umbra", fixturePath);
            assert.notEqual(loaded.tree.root.name, "", fixturePath);
        }
    }

    const recursiveCte = loadFixture("umbra/cte-recursive-analyze.plan.json").tree;
    assert.equal(recursiveCte.crosslinks?.length, 1);
    assert.ok(treeNodes(recursiveCte.root).some((node) => node.name === "iterationincrementscan"));

    const analyzedScan = loadFixture("umbra/tablescan-analyze.plan.json").tree;
    assert.notEqual(analyzedScan.root.iconColor, undefined);
    assert.equal(analyzedScan.root.edgeLabel, "5/5");
    assert.ok(treeNodes(analyzedScan.root).some((node) => node.name === "analyzePlanPipelines"));

    const markJoin = loadFixture("umbra/markjoin-analyze.plan.json").tree;
    assert.equal(markJoin.root.name, "leftmark");
    assert.equal(markJoin.root.icon, undefined);

    const optimizerSteps = loadFixture("cedardb/tpch/tpch-q2-steps.plan.json").tree;
    assert.equal(optimizerSteps.root.name, "optimizer steps");
    assert.equal(optimizerSteps.root.children?.length, 10);
    assert.equal(optimizerSteps.root.children?.[0].children, undefined);
    assert.equal(optimizerSteps.root.children?.[0].collapsedChildren?.length, 1);

    for (const fixturePath of [...fixturePaths("umbra"), ...fixturePaths("cedardb")]) {
        for (const crosslink of loadFixture(fixturePath).tree.crosslinks ?? []) {
            assert.ok(!allChildren(crosslink.source).includes(crosslink.target), fixturePath);
        }
    }

    const shadowedMethod = JSON.parse(readFileSync(path.join(examplesRoot, "umbra/tablescan-analyze.plan.json"), "utf8"));
    shadowedMethod.plan.hasOwnProperty = false;
    assert.equal(loadPlanFromTextWithFormat(JSON.stringify(shadowedMethod)).format, "umbra");
});

test("loads every DuckDB example semantically", () => {
    for (const fixturePath of fixturePaths("duckdb")) {
        const loaded = loadFixture(fixturePath);
        assert.equal(loaded.format, "duckdb", fixturePath);
        assert.notEqual(loaded.tree.root.name, "", fixturePath);
    }

    const analyzedScan = loadFixture("duckdb/tablescan-analyze.plan.json").tree;
    assert.equal(analyzedScan.root.name, '"temp".main.region (SEQ_SCAN)');
    assert.equal(analyzedScan.root.edgeLabel, "5/5");
    assert.notEqual(analyzedScan.root.nodeColor, undefined);

    const cte = loadFixture("duckdb/cte-analyze.plan.json").tree;
    assert.equal(cte.crosslinks?.length, 2);

    const simplePlan = loadFixture("duckdb/tpch/tpch-q2.plan.json").tree;
    assert.equal(simplePlan.root.name, "TOP_N");
    assert.equal(simplePlan.root.icon, "sort-symbol");

    const actualOnly = treeNodes(loadFixture("duckdb/groupby-analyze.plan.json").tree.root).find(
        (node) => node.name === "PERFECT_HASH_GROUP_BY",
    );
    assert.equal(actualOnly?.edgeLabel, "3");

    const optimizerStages = loadFixture("duckdb/tpch/tpch-q2-steps.plan.json").tree;
    assert.equal(optimizerStages.root.name, "optimizer stages");
    assert.equal(optimizerStages.root.children?.length, 3);
    assert.equal(optimizerStages.root.children?.[0].collapsedChildren?.[0].name, "LIMIT");

    const missingChildDetail = JSON.parse(readFileSync(path.join(examplesRoot, "duckdb/tpch/tpch-q2.plan.json"), "utf8"));
    delete missingChildDetail[0].children[0].extra_info;
    assert.equal(loadPlanFromTextWithFormat(JSON.stringify(missingChildDetail)).format, "duckdb");

    const malformedAnalyze = JSON.parse(readFileSync(path.join(examplesRoot, "duckdb/tablescan-analyze.plan.json"), "utf8"));
    malformedAnalyze.children[0].children[0] = 7;
    const degradedAnalyze = loadPlanFromTextWithFormat(JSON.stringify(malformedAnalyze));
    assert.equal(degradedAnalyze.format, "duckdb");
    assert.equal(degradedAnalyze.tree.root.children?.[0].name, "7");
});

test("Hyper loader output remains stable", () => {
    const digests = Object.fromEntries(
        fixturePaths("hyper").map((fixturePath) => [fixturePath, treeDigest(loadFixture(fixturePath).tree)]),
    );
    assert.deepEqual(digests, {
        "hyper/cte-analyze.plan.json": "ab40f261f1dfa84aadbe9f4cc63ee59efc75382e8868e2161f5955fb1bdb52fd",
        "hyper/cte-recursive-analyze.plan.json": "8da72d234bf08fbead371bef19683435a28b316c91a3c2c3e5d3690518b375ba",
        "hyper/forkshare-pipelines.plan.json": "1f7cb183d6c1e2fbacd6b5155ffb3f149d85a7dd6c2ffe4f4d0f4b83075e8e3e",
        "hyper/groupby-analyze.plan.json": "341331deaae054a3769155692581d95ba010793278027a395b77137a294db18c",
        "hyper/insert.plan.json": "9750a0dddf1adfbbf4a8d8ac83bc6ccd9c4d1fa23ade49c0e20380207dbcbeaf",
        "hyper/magicunnesting-analyze-pipelines.plan.json": "c0ab3660623b7b3fd0fd963333550d1b3ad4a8f3d90d8bde7ef5e5e464492000",
        "hyper/magicunnesting-analyze.plan.json": "f31d45075c5fa89b37dd9eee444d28469113d39f5d7ed94157ec5ccfabe2f7f7",
        "hyper/magicunnesting-pipelines.plan.json": "3cb44c54d40e0896eafb4aef6c04c465bce986eb300d97cb10a7729320923592",
        "hyper/markjoin-analyze.plan.json": "a4886bc9d3db5386c07c1037bb1a17b6316629dc54053ca36878e992c345414a",
        "hyper/materialized-pipelines.plan.json": "f531fc9000c177b68d121e38cc25ce9cf142ca5261394c0b64c0f536ea9cd48e",
        "hyper/metadata-describe-table.plan.json": "5f51e2ac9f5fa6c2f125ef947710bc8bf8dd466c2149fc5d61585f371ddff8c5",
        "hyper/setoperation-analyze.plan.json": "1074d967649605d9c4df8c4907f67cb7704a6710bcc1c388be8e73535695e7f8",
        "hyper/tableconstruction.plan.json": "8209f30c77f5a4fcae40be8df47f8e2eb5217006f68b4ebd8ec11c992e26d395",
        "hyper/tablefunction.plan.json": "d9e82d204ddc8e9188b48f28cf2ad3db0316041cc99da30cb326525528ee5a43",
        "hyper/tablescan-analyze.plan.json": "4a6fbda2423341df56ccbf53ed2665b5e9dcba454248589d9c597a2c329be85b",
        "hyper/tpch-q11-error-analyze.plan.json": "77b836c3544e6adce74c1d143a0120fd636ab92f513edd61e8243655ddbeb9ad",
        "hyper/tpch/tpch-q1-analyze.plan.json": "c6cf66b2ee86d590bb8bc2d986e1b028e886b41cdf8e22ed5da39ed99bb7c95d",
        "hyper/tpch/tpch-q1-external-analyze.plan.json": "0f6dcb6b3a1b0d605595791fda8396bd03721cc47d80829d6ba34c408fb24ede",
        "hyper/tpch/tpch-q10-analyze.plan.json": "a66d29ab2351f0a7717ecab51bd1cc1e559d3fc30792ddeafa909f631ff06792",
        "hyper/tpch/tpch-q11-analyze.plan.json": "7b3fa6911bcacb326f357b892341933f2e4fc4e743d5a8a7b6ba9c5f79b91e8f",
        "hyper/tpch/tpch-q12-analyze.plan.json": "0563c4c9576066befd2abf76c62a6a6eb8fd234bedab3fa985ef42865465314f",
        "hyper/tpch/tpch-q13-analyze.plan.json": "6a5524fb9bba36e0b29ede0dbfd7f0410b9f59ffca2f2abe70962d503bd14113",
        "hyper/tpch/tpch-q14-analyze.plan.json": "390913b9f165eee58c3b64fe8c401bf5ed7df021452e5fedbd10c6a028a6eae5",
        "hyper/tpch/tpch-q15-analyze.plan.json": "60584538f7a6e0cf731971521f3eb0ba66e040ceee6845e2ef4fb1a86db3ce77",
        "hyper/tpch/tpch-q16-analyze.plan.json": "b250a922a09dfea0780af5092bcda82cf0a16c73998c646e5ad0f79f5218b86e",
        "hyper/tpch/tpch-q17-analyze.plan.json": "e5dc5975921b573788dfee53c3c933582f5e29890978e32ee388c3d77d5a15bd",
        "hyper/tpch/tpch-q18-analyze.plan.json": "5b0d2bc23f8f4b4c7e42902cafff013cd614b3d3fbb5cf6dbcfe5eb54c2ee4a4",
        "hyper/tpch/tpch-q19-analyze.plan.json": "29c4133d9901fa7edf8f4d6988b700c8113c436caae49f8d09cd894fec37b1b3",
        "hyper/tpch/tpch-q2-analyze.plan.json": "5ff0f5a444f01511a5abb09cfc392ef633dd1cbe33ae952808f9b7e3555e7a57",
        "hyper/tpch/tpch-q2-steps.plan.json": "4d7bcbbdb79e942ea8e04139a022e3501a6ab242222e1eb804ecfb8293994230",
        "hyper/tpch/tpch-q2.plan.json": "c5fb3be15448f07fae7e0aa92e865040e63581ae9b39442ffd813a2f9526da63",
        "hyper/tpch/tpch-q20-analyze.plan.json": "1d5e42994ab384cff39e741958bea171e50f0c493161a313dab235db5a7f0068",
        "hyper/tpch/tpch-q21-analyze.plan.json": "f7856fc16e7a30c0573c94111391b9d18eaa9a0d099f904e321af3ac7dd69277",
        "hyper/tpch/tpch-q22-analyze.plan.json": "dc715e5af56273d74a60a2320eaf34356f9750819846622a8eb05f9676fbd015",
        "hyper/tpch/tpch-q3-analyze.plan.json": "cc723cbbb3fa82bae884dfc69193ffd3000c20f6609f1f714472f280cfad2dc3",
        "hyper/tpch/tpch-q4-analyze.plan.json": "0d4d449b8b446424e4d584f3ac600397ef6b7e3c3b39c9c3e461eb18e0c49a5a",
        "hyper/tpch/tpch-q5-analyze.plan.json": "c8ca67af7660a9465b506bb39c3a89ecd71c87a7f7720256d2c68a7e48cc3101",
        "hyper/tpch/tpch-q6-analyze.plan.json": "711de722b77a40897750121a07a749be190a4eeaee530de4d117ec16719a3f1b",
        "hyper/tpch/tpch-q7-analyze.plan.json": "8f28feec42c9cb1c0e205dd77efc8da0619bd0f1f7b2139810c9e18a7ab7381c",
        "hyper/tpch/tpch-q8-analyze.plan.json": "22474d24a146c87e7186ff3a7863ec293b6d095e826b50bb434d314c71c419f0",
        "hyper/tpch/tpch-q9-analyze.plan.json": "2bd4a49445390f6ce997692c675e1deadf786f5f7eb313421b060830453f356f",
        "hyper/unionall-pipelines.plan.json": "7d1bae42b57594e8312265d27d871932441b230b28df54aa7cfcee3455725874",
        "hyper/window-analyze.plan.json": "53d1986ee45a083ac8a87ff66789fffb8ac44a655746f1ed30d81d15b709d42f",
    });
});

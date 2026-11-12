import assert from "node:assert/strict";
import test from "node:test";
import {gzipSync} from "node:zlib";
import {loadPlanFromText} from "@tableau/query-graphs/lib/loaders";
import {loadFileText} from "../src/loadFileText";

// Using non-asci chars on purpose to verify decoding works properly
const planText = '{\n   "query": "SELECT \'Grüße 😀\'"\n}';
const sqlText = "SELECT 'Grüße 😀';";

function dataUrl(text: string, mediaType: string, compressed: boolean): URL {
    const bytes = compressed ? gzipSync(text) : Buffer.from(text, "utf8");
    return new URL(`data:${compressed ? "application/gzip" : mediaType};base64,${bytes.toString("base64")}`);
}

test("loads a compressed plan file alongside uncompressed SQL", async () => {
    const signal = new AbortController().signal;
    const [text, sql] = await Promise.all([
        loadFileText(dataUrl(planText, "application/json", true), signal),
        loadFileText(dataUrl(sqlText, "text/plain", false), signal),
    ]);

    const plan = loadPlanFromText(text, {sql});
    assert.equal(plan.tree.textDocuments?.find(({id}) => id === "plan")?.text, planText);
    assert.equal(plan.tree.textDocuments?.find(({id}) => id === "query")?.text, sqlText);
});

test("loads an uncompressed plan file alongside compressed SQL", async () => {
    const signal = new AbortController().signal;
    const [text, sql] = await Promise.all([
        loadFileText(dataUrl(planText, "application/json", false), signal),
        loadFileText(dataUrl(sqlText, "text/plain", true), signal),
    ]);

    const plan = loadPlanFromText(text, {sql});
    assert.equal(plan.tree.textDocuments?.find(({id}) => id === "plan")?.text, planText);
    assert.equal(plan.tree.textDocuments?.find(({id}) => id === "query")?.text, sqlText);
});

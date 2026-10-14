import assert from "node:assert/strict";
import {copyFile, mkdtemp, mkdir, open, rm, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {MAX_APP_HTML_BYTES, MAX_FILE_BYTES, RESOURCE_URI} from "../src/limits.mjs";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(packageDir, "dist");
const requireFromApps = createRequire(import.meta.resolve("@modelcontextprotocol/ext-apps"));
const {Client} = requireFromApps("@modelcontextprotocol/client");
const {StdioClientTransport} = requireFromApps("@modelcontextprotocol/client/stdio");

test("cold-copy server exposes one tool and delivers bounded private plan text to the app", async (t) => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "query-graphs-mcp-app-"));
    t.after(() => rm(tempDir, {recursive: true, force: true}));
    const planPath = path.join(tempDir, "plan.json");
    const sqlPath = path.join(tempDir, "query.sql");
    const missingPath = path.join(tempDir, "missing.plan");
    const oversizedPath = path.join(tempDir, "oversized.plan");
    const escapedPath = path.join(tempDir, "escaped.plan");
    const pairedPlanPath = path.join(tempDir, "paired.plan");
    const pairedSqlPath = path.join(tempDir, "paired.sql");
    const planText = '{"operator":"result-sink","operator-id":10,"description":"π雪","inputs":[]}';
    const sqlText = "select 'PRIVATE_SQL_π' from data;";
    await writeFile(planPath, planText);
    await writeFile(sqlPath, sqlText);
    const oversized = await open(oversizedPath, "w");
    await oversized.truncate(MAX_FILE_BYTES + 1);
    await oversized.close();
    await writeFile(escapedPath, "\0".repeat(1_500_000));
    await writeFile(pairedPlanPath, "p".repeat(4_250_000));
    await writeFile(pairedSqlPath, "s".repeat(4_250_000));

    const coldCopy = path.join(tempDir, "marketplace-copy");
    await mkdir(coldCopy);
    const serverPath = path.join(coldCopy, "server.mjs");
    await copyFile(path.join(distDir, "server.mjs"), serverPath);
    await copyFile(path.join(distDir, "view.html"), path.join(coldCopy, "view.html"));

    const client = new Client(
        {name: "query-graphs-plugin-test", version: "1.0.0"},
        {capabilities: {extensions: {"io.modelcontextprotocol/ui": {mimeTypes: ["text/html;profile=mcp-app"]}}}},
    );
    const transport = new StdioClientTransport({command: process.execPath, args: [serverPath], cwd: coldCopy, stderr: "pipe"});
    let stderr = "";
    transport.stderr?.on("data", (chunk) => (stderr += chunk.toString("utf8")));
    t.after(() => client.close());
    await client.connect(transport);

    const {tools} = await client.listTools();
    assert.deepEqual(
        tools.map(({name}) => name),
        ["open_query_plan"],
    );
    assert.equal(tools[0]._meta.ui.resourceUri, RESOURCE_URI);
    const {resources} = await client.listResources();
    assert.ok(resources.some(({uri}) => uri === RESOURCE_URI));
    const resource = await client.readResource({uri: RESOURCE_URI});
    assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
    assert.ok(Buffer.byteLength(resource.contents[0].text) <= MAX_APP_HTML_BYTES);

    const empty = await client.callTool({name: "open_query_plan", arguments: {}});
    assert.deepEqual(empty.structuredContent, {
        status: "empty",
        title: "Untitled",
        planBytes: 0,
        sqlBytes: 0,
        hasSql: false,
        format: null,
    });
    assert.deepEqual(empty._meta, {planText: null, sqlText: null});

    const opened = await client.callTool({
        name: "open_query_plan",
        arguments: {path: planPath, sqlPath, format: "hyper", title: path.join(tempDir, "display-title.plan")},
    });
    assert.equal(opened.structuredContent.status, "prepared");
    assert.equal(opened.structuredContent.title, "display-title.plan");
    assert.equal(opened.structuredContent.planBytes, Buffer.byteLength(planText));
    assert.equal(opened.structuredContent.sqlBytes, Buffer.byteLength(sqlText));
    assert.equal(opened.structuredContent.hasSql, true);
    assert.equal(opened.structuredContent.format, "hyper");
    assert.deepEqual(opened._meta, {planText, sqlText});
    const modelVisible = JSON.stringify({content: opened.content, structuredContent: opened.structuredContent});
    assert.equal(modelVisible.includes(tempDir), false);
    assert.doesNotMatch(modelVisible, /π雪|PRIVATE_SQL/);

    const noPlan = await client.callTool({name: "open_query_plan", arguments: {sqlPath}});
    assert.equal(noPlan.isError, true);
    assert.match(noPlan.content[0].text, /requires a plan path/);
    const missing = await client.callTool({name: "open_query_plan", arguments: {path: missingPath}});
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /does not exist/);
    assert.equal(missing.content[0].text.includes(tempDir), false);

    const oversizedFile = await client.callTool({name: "open_query_plan", arguments: {path: oversizedPath}});
    assert.equal(oversizedFile.isError, true);
    assert.match(oversizedFile.content[0].text, /8 MiB response budget/);
    const escaped = await client.callTool({name: "open_query_plan", arguments: {path: escapedPath}});
    assert.equal(escaped.isError, true);
    assert.match(escaped.content[0].text, /8 MiB response budget/);
    const paired = await client.callTool({
        name: "open_query_plan",
        arguments: {path: pairedPlanPath, sqlPath: pairedSqlPath},
    });
    assert.equal(paired.isError, true);
    assert.match(paired.content[0].text, /8 MiB response budget/);
    assert.equal(stderr, "");
});

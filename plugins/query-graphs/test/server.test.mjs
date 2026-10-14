import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {copyFile, mkdir, mkdtemp, open, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createInterface} from "node:readline";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {MAX_APP_HTML_BYTES, MAX_CHUNK_BYTES, MAX_FILE_BYTES, RESOURCE_URI} from "../src/limits.mjs";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(packageDir, "dist", "server.mjs");

class StdioMcpClient {
    #process;
    #pending = new Map();
    #nextId = 1;
    #stdout;
    #invalidStdout = [];
    #stderr = "";

    constructor(serverProcess) {
        this.#process = serverProcess;
        this.#stdout = createInterface({input: serverProcess.stdout});
        serverProcess.stderr.on("data", (chunk) => {
            this.#stderr += chunk.toString("utf8");
        });
        this.#stdout.on("line", (line) => {
            let message;
            try {
                message = JSON.parse(line);
            } catch {
                this.#invalidStdout.push(line);
                return;
            }
            if (message.id === undefined) return;
            const pending = this.#pending.get(message.id);
            if (!pending) return;
            this.#pending.delete(message.id);
            clearTimeout(pending.timeout);
            if (message.error) pending.reject(new Error(message.error.message || "MCP request failed."));
            else pending.resolve(message.result);
        });
    }

    request(method, params = {}) {
        const id = this.#nextId++;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.#pending.delete(id);
                reject(
                    new Error(
                        `Timed out waiting for ${method}. Child ${this.#process.pid} exited with ${this.#process.exitCode}/${this.#process.signalCode}. Stderr: ${this.#stderr}`,
                    ),
                );
            }, 15_000);
            this.#pending.set(id, {resolve, reject, timeout});
            this.#process.stdin.write(`${JSON.stringify({jsonrpc: "2.0", id, method, params})}\n`);
        });
    }

    notify(method, params = {}) {
        this.#process.stdin.write(`${JSON.stringify({jsonrpc: "2.0", method, params})}\n`);
    }

    get invalidStdout() {
        return this.#invalidStdout;
    }

    async close() {
        this.#process.stdin.end();
        await new Promise((resolve, reject) => {
            if (this.#process.exitCode !== null || this.#process.signalCode !== null) return resolve();
            const timeout = setTimeout(() => {
                this.#process.kill("SIGKILL");
                reject(new Error("MCP server did not exit after stdio closed."));
            }, 5_000);
            this.#process.once("exit", () => {
                clearTimeout(timeout);
                resolve();
            });
        });
        this.#stdout.close();
    }
}

async function startClient(coldCopy) {
    const selectedServerPath = coldCopy ?? serverPath;
    const serverProcess = spawn(process.execPath, [selectedServerPath], {
        cwd: path.dirname(selectedServerPath),
        stdio: ["pipe", "pipe", "pipe"],
    });
    const client = new StdioMcpClient(serverProcess);
    await client.request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {extensions: {"io.modelcontextprotocol/ui": {mimeTypes: ["text/html;profile=mcp-app"]}}},
        clientInfo: {name: "query-graphs-plugin-test", version: "1.0.0"},
    });
    client.notify("notifications/initialized");
    return client;
}

test("stdio app prepares private immutable plan and SQL snapshots with bounded app-only reads", async (t) => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "query-graphs-mcp-app-"));
    const planPath = path.join(tempDir, "plan.json");
    const sqlPath = path.join(tempDir, "query.sql");
    const oversizedPath = path.join(tempDir, "oversized.plan");
    const planText = '{"plan":"π雪"}\n';
    const sqlText = "select 'private SQL';";
    await writeFile(planPath, planText);
    await writeFile(sqlPath, sqlText);
    const oversized = await open(oversizedPath, "w");
    await oversized.truncate(MAX_FILE_BYTES + 1);
    await oversized.close();

    const coldCopy = path.join(tempDir, "marketplace-copy");
    await mkdir(coldCopy);
    await copyFile(serverPath, path.join(coldCopy, "server.mjs"));
    await copyFile(path.join(packageDir, "dist", "view.html"), path.join(coldCopy, "view.html"));
    const client = await startClient(path.join(coldCopy, "server.mjs"));
    t.after(async () => {
        await client.close();
        await rm(tempDir, {recursive: true, force: true});
    });

    const tools = await client.request("tools/list");
    const openTool = tools.tools.find((tool) => tool.name === "open_query_plan");
    const chunkTool = tools.tools.find((tool) => tool.name === "read_plan_chunk");
    assert.ok(openTool);
    assert.ok(chunkTool);
    assert.equal(openTool._meta.ui.resourceUri, RESOURCE_URI);
    assert.deepEqual(openTool._meta["openai/ui"].preferredModelDisplayMode, "fullscreen");
    assert.deepEqual(Object.keys(openTool.outputSchema.properties).sort(), [
        "chunkBytes",
        "format",
        "handle",
        "hasSql",
        "planBytes",
        "sqlBytes",
        "status",
        "title",
    ]);
    assert.deepEqual(chunkTool._meta.ui.visibility, ["app"]);
    assert.deepEqual(Object.keys(chunkTool.outputSchema.properties).sort(), ["base64", "length", "offset", "totalBytes"]);
    assert.equal(chunkTool.inputSchema.properties.length.maximum, MAX_CHUNK_BYTES);

    const resources = await client.request("resources/list");
    assert.ok(resources.resources.some((resource) => resource.uri === RESOURCE_URI));
    const resource = await client.request("resources/read", {uri: RESOURCE_URI});
    const html = resource.contents[0].text;
    assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
    assert.deepEqual(resource.contents[0]._meta["openai/ui"].availableDisplayModes, ["fullscreen", "inline"]);
    assert.deepEqual(resource.contents[0]._meta.ui.csp.resourceDomains, []);
    assert.deepEqual(resource.contents[0]._meta.ui.csp.connectDomains, []);
    assert.ok(Buffer.byteLength(html) <= MAX_APP_HTML_BYTES);
    assert.match(html, /<script>/);
    assert.doesNotMatch(html, /<script[^>]+src=/i);
    assert.doesNotMatch(html, /<link[^>]+href=/i);
    assert.doesNotMatch(html, /\bimport\s*\(/);
    const inlineStyle = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
    assert.ok(inlineStyle);
    assert.doesNotMatch(inlineStyle, /url\(\s*["']?https?:/i);

    const empty = await client.request("tools/call", {name: "open_query_plan", arguments: {}});
    assert.equal(empty.structuredContent.status, "empty");
    assert.equal(empty.structuredContent.handle, null);
    assert.match(empty.content[0].text, /No plan has been parsed or rendered/);

    const opened = await client.request("tools/call", {
        name: "open_query_plan",
        arguments: {path: planPath, sqlPath, title: path.join(tempDir, "display-title.plan")},
    });
    assert.equal(opened.structuredContent.status, "prepared");
    assert.equal(opened.structuredContent.title, "display-title.plan");
    assert.equal(opened.structuredContent.planBytes, Buffer.byteLength(planText));
    assert.equal(opened.structuredContent.sqlBytes, Buffer.byteLength(sqlText));
    assert.equal(opened.structuredContent.hasSql, true);
    assert.equal(opened.structuredContent.chunkBytes, MAX_CHUNK_BYTES);
    assert.equal(typeof opened.structuredContent.handle, "string");
    assert.equal(opened.content[0].text.includes(tempDir), false);
    assert.equal(opened.content[0].text.includes(planText), false);
    assert.equal(opened.content[0].text.includes(sqlText), false);
    assert.equal(JSON.stringify(opened.structuredContent).includes(tempDir), false);

    await writeFile(planPath, "changed after opening");
    const planChunks = [];
    const readChunk = async (document, offset, length) =>
        client.request("tools/call", {
            name: "read_plan_chunk",
            arguments: {handle: opened.structuredContent.handle, document, offset, length},
        });
    let planOffset = 0;
    while (planOffset < opened.structuredContent.planBytes) {
        const result = await readChunk("plan", planOffset, Math.min(MAX_CHUNK_BYTES, 7));
        assert.equal(result.structuredContent.offset, planOffset);
        assert.equal(result.structuredContent.totalBytes, opened.structuredContent.planBytes);
        planChunks.push(Buffer.from(result.structuredContent.base64, "base64"));
        planOffset += result.structuredContent.length;
    }
    assert.equal(Buffer.concat(planChunks).toString("utf8"), planText);

    const sql = await readChunk("sql", 0, MAX_CHUNK_BYTES);
    assert.equal(Buffer.from(sql.structuredContent.base64, "base64").toString("utf8"), sqlText);
    const planOnly = await client.request("tools/call", {name: "open_query_plan", arguments: {path: planPath}});
    const noSql = await client.request("tools/call", {
        name: "read_plan_chunk",
        arguments: {handle: planOnly.structuredContent.handle, document: "sql", offset: 0, length: 1},
    });
    assert.equal(noSql.isError, true);
    assert.match(noSql.content[0].text, /no SQL document/);

    const missing = await client.request("tools/call", {
        name: "open_query_plan",
        arguments: {path: path.join(tempDir, "missing.plan")},
    });
    assert.equal(missing.isError, true);
    assert.equal(missing.content[0].text.includes(tempDir), false);

    const oversizedResult = await client.request("tools/call", {name: "open_query_plan", arguments: {path: oversizedPath}});
    assert.equal(oversizedResult.isError, true);
    assert.match(oversizedResult.content[0].text, /at most/);
    assert.deepEqual(client.invalidStdout, []);
});

test("server rejects sqlPath without a plan and refuses expired or invalid handles", async (t) => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "query-graphs-mcp-errors-"));
    const client = await startClient();
    t.after(async () => {
        await client.close();
        await rm(tempDir, {recursive: true, force: true});
    });
    const sqlPath = path.join(tempDir, "query.sql");
    await writeFile(sqlPath, "select 1");
    const invalidPair = await client.request("tools/call", {name: "open_query_plan", arguments: {sqlPath}});
    assert.equal(invalidPair.isError, true);
    assert.match(invalidPair.content[0].text, /requires a plan path/);

    const invalidHandle = await client.request("tools/call", {
        name: "read_plan_chunk",
        arguments: {handle: "not-a-handle", document: "plan", offset: 0, length: 1},
    });
    assert.equal(invalidHandle.isError, true);
    assert.match(invalidHandle.content[0].text, /invalid, expired, or evicted/);
});

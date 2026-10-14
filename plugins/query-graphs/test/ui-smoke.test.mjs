import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {JSDOM, VirtualConsole} from "jsdom";
import {MAX_CHUNK_BYTES} from "../src/limits.mjs";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = path.join(packageDir, "dist", "view.html");

function deferred() {
    let resolve;
    const promise = new Promise((done) => (resolve = done));
    return {promise, resolve};
}

function preparedResult({handle, title, plan, sql, format = "hyper"}) {
    const planBytes = Buffer.from(plan, "utf8");
    const sqlBytes = sql === undefined ? undefined : Buffer.from(sql, "utf8");
    return {
        metadata: {
            status: "prepared",
            title,
            handle,
            planBytes: planBytes.length,
            sqlBytes: sqlBytes?.length ?? 0,
            hasSql: sqlBytes !== undefined,
            format,
            chunkBytes: MAX_CHUNK_BYTES,
        },
        documents: {plan: planBytes, ...(sqlBytes === undefined ? {} : {sql: sqlBytes})},
    };
}

function planText(operatorId, includeChild = true) {
    return JSON.stringify({
        operator: "result-sink",
        "operator-id": operatorId,
        inputs: includeChild ? [{operator: "scan", type: "native", "operator-id": operatorId + 1, sqlpos: [[0, 6]]}] : [],
    });
}

async function createHarness() {
    const html = await readFile(htmlPath, "utf8");
    let window;
    const errors = [];
    const requests = [];
    const snapshots = new Map();
    const readGates = new Map();
    let hostContext = {theme: "light", displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"]};

    const host = {
        postMessage(message) {
            requests.push(message);
            if (message.id === undefined) return;
            void (async () => {
                let result;
                if (message.method === "ui/initialize") {
                    result = {
                        protocolVersion: message.params.protocolVersion,
                        hostInfo: {name: "Query Graphs test host", version: "1.0"},
                        hostCapabilities: {serverTools: {}, logging: {}},
                        hostContext,
                    };
                } else if (message.method === "ui/request-display-mode") {
                    result = {mode: "inline"};
                } else if (message.method === "tools/call" && message.params?.name === "read_plan_chunk") {
                    const {handle, document, offset, length} = message.params.arguments;
                    const gate = readGates.get(handle);
                    if (gate) await gate.promise;
                    const bytes = snapshots.get(handle)?.[document];
                    if (!bytes) throw new Error(`Missing ${document} snapshot for ${handle}.`);
                    const chunk = bytes.subarray(offset, offset + length);
                    result = {
                        content: [{type: "text", text: `Read ${chunk.length} bytes at offset ${offset}.`}],
                        structuredContent: {
                            offset,
                            length: chunk.length,
                            totalBytes: bytes.length,
                            base64: chunk.toString("base64"),
                        },
                    };
                } else if (message.method === "ping") {
                    result = {};
                } else {
                    throw new Error(`Unexpected app request: ${message.method}`);
                }
                window.dispatchEvent(
                    new window.MessageEvent("message", {source: host, data: {jsonrpc: "2.0", id: message.id, result}}),
                );
            })().catch((error) => {
                errors.push(String(error));
                window.dispatchEvent(
                    new window.MessageEvent("message", {
                        source: host,
                        data: {jsonrpc: "2.0", id: message.id, error: {code: -32000, message: String(error)}},
                    }),
                );
            });
        },
    };

    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", (error) => {
        if (error.type !== "css-parsing") errors.push(String(error));
    });
    virtualConsole.on("error", (...args) => errors.push(args.map(String).join(" ")));
    const dom = new JSDOM(html, {
        url: "http://localhost/",
        runScripts: "dangerously",
        pretendToBeVisual: true,
        virtualConsole,
        beforeParse(windowValue) {
            window = windowValue;
            Object.defineProperty(window, "parent", {configurable: true, value: host});
            window.TextEncoder = TextEncoder;
            window.TextDecoder = TextDecoder;
            window.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}});
            window.ResizeObserver = class {
                constructor(callback) {
                    this.callback = callback;
                }

                observe(target) {
                    window.requestAnimationFrame(() => {
                        if (target.isConnected) this.callback([{target, contentRect: target.getBoundingClientRect()}]);
                    });
                }

                unobserve() {}
                disconnect() {}
            };
            window.DOMMatrixReadOnly = class {
                m11 = 1;
                m22 = 1;
            };
            window.HTMLElement.prototype.getBoundingClientRect = () => ({
                width: 1000,
                height: 700,
                top: 0,
                left: 0,
                bottom: 700,
                right: 1000,
                x: 0,
                y: 0,
                toJSON() {},
            });
        },
    });

    const waitFor = async (predicate, description) => {
        for (let attempt = 0; attempt < 250; attempt += 1) {
            if (predicate()) return;
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error(
            `Timed out waiting for ${description}. DOM: ${window.document.body.textContent.slice(-1200)} Errors: ${errors.join("\n")}`,
        );
    };
    const notify = (method, params) =>
        window.dispatchEvent(new window.MessageEvent("message", {source: host, data: {jsonrpc: "2.0", method, params}}));
    const openPrepared = ({handle, title, plan, sql, format}) => {
        const fixture = preparedResult({handle, title, plan, sql, format});
        snapshots.set(handle, fixture.documents);
        notify("ui/notifications/tool-result", {
            content: [{type: "text", text: "Prepared plan."}],
            structuredContent: fixture.metadata,
        });
    };
    const setReadGate = (handle) => {
        const gate = deferred();
        readGates.set(handle, gate);
        return gate;
    };

    await waitFor(() => requests.some(({method}) => method === "ui/notifications/initialized"), "MCP Apps initialization");
    return {
        dom,
        errors,
        host,
        notify,
        openPrepared,
        readGates,
        requests,
        setReadGate,
        snapshots,
        waitFor,
        updateHostContext(update) {
            hostContext = {...hostContext, ...update};
            notify("ui/notifications/host-context-changed", update);
        },
    };
}

test("bundled viewer boots empty, renders graph and source documents, and follows host theme/display updates", async (t) => {
    const harness = await createHarness();
    t.after(() => harness.dom.window.close());
    const {document} = harness.dom.window;

    await harness.waitFor(
        () => document.querySelector(".qg-plugin-status")?.textContent.includes("Paste or drop a query plan"),
        "empty viewer",
    );
    assert.equal(document.querySelectorAll(".react-flow__node").length, 0);

    harness.openPrepared({
        handle: "rendered",
        title: "rendered-plan.json",
        plan: planText(10),
        sql: "SELECT value FROM table",
        format: "hyper",
    });
    await harness.waitFor(
        () => document.querySelector(".qg-plugin-status")?.textContent === "Loaded hyper query plan (2 nodes).",
        "prepared plan parse and graph render",
    );
    await harness.waitFor(() => document.querySelectorAll(".react-flow__node").length === 2, "measured graph nodes");
    assert.equal(
        document.querySelectorAll(".react-flow__node").length,
        2,
        document.querySelector(".query-graph")?.outerHTML?.slice(0, 1500) ?? document.body.textContent,
    );
    const sourcePanels = [...document.querySelectorAll(".graph-text-document-panel")].map(({textContent}) => textContent);
    assert.ok(sourcePanels.some((title) => title.includes("Query Plan")));
    assert.ok(sourcePanels.some((title) => title.includes("Original SQL Query")));
    const renderedNode = document.querySelector(".react-flow__node");
    assert.ok(renderedNode);

    const shell = document.getElementById("plugin-shell");
    assert.ok(shell.contains(document.getElementById("expand")));
    assert.ok(shell.contains(document.getElementById("display-error")));
    await harness.waitFor(() => !document.getElementById("display-error").hidden, "inline display-mode feedback");
    harness.updateHostContext({theme: "dark", displayMode: "fullscreen"});
    await harness.waitFor(
        () => shell.dataset.theme === "dark" && document.getElementById("expand").hidden,
        "dark fullscreen host context",
    );
    assert.equal(document.querySelectorAll(".react-flow__node").length, 2);
    assert.equal(renderedNode.isConnected, true);
    assert.equal(document.getElementById("display-error").hidden, true);
    assert.equal(harness.dom.window.getComputedStyle(shell).getPropertyValue("--qg-danger").trim(), "#ff8790");

    harness.updateHostContext({displayMode: "inline"});
    await harness.waitFor(() => !document.getElementById("expand").hidden, "inline display mode");
    assert.equal(document.querySelector(".qg-plugin-status")?.textContent, "Loaded hyper query plan (2 nodes).");
    assert.deepEqual(harness.errors, []);
});

test("bundled viewer displays invalid-plan errors and ignores cancelled or superseded transfers", async (t) => {
    const harness = await createHarness();
    t.after(() => harness.dom.window.close());
    const {document} = harness.dom.window;

    harness.openPrepared({handle: "invalid", title: "invalid.plan", plan: "not valid JSON", format: "hyper"});
    await harness.waitFor(
        () => document.querySelector('.qg-plugin-status[role="alert"]')?.textContent,
        "visible invalid-plan error",
    );
    assert.notEqual(document.querySelector('.qg-plugin-status[role="alert"]').textContent.trim(), "");

    const staleGate = harness.setReadGate("stale");
    harness.openPrepared({handle: "stale", title: "stale.plan", plan: planText(20), format: "hyper"});
    await harness.waitFor(
        () => harness.requests.some((message) => message.method === "tools/call" && message.params?.arguments?.handle === "stale"),
        "stale plan chunk request",
    );
    harness.openPrepared({handle: "latest", title: "latest.plan", plan: planText(30), format: "hyper"});
    await harness.waitFor(
        () => document.querySelector(".qg-plugin-status")?.textContent === "Loaded hyper query plan (2 nodes).",
        "latest plan render",
    );
    staleGate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(document.querySelector(".graph-title")?.value, "latest.plan");
    assert.equal(document.querySelectorAll(".react-flow__node").length, 2);

    const cancelledGate = harness.setReadGate("cancelled");
    harness.openPrepared({handle: "cancelled", title: "cancelled.plan", plan: planText(40, false), format: "hyper"});
    await harness.waitFor(
        () =>
            harness.requests.some(
                (message) => message.method === "tools/call" && message.params?.arguments?.handle === "cancelled",
            ),
        "cancelled plan chunk request",
    );
    harness.notify("ui/notifications/tool-cancelled", {reason: "user action"});
    await harness.waitFor(
        () => document.querySelector('.qg-plugin-status[role="alert"]')?.textContent.includes("cancelled"),
        "visible cancellation status",
    );
    cancelledGate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(document.querySelector(".graph-title")?.value, "latest.plan");
    assert.equal(document.querySelectorAll(".react-flow__node").length, 2);
    assert.deepEqual(harness.errors, []);
});

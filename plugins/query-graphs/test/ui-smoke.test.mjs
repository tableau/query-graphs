import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {JSDOM, VirtualConsole} from "jsdom";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = path.join(packageDir, "dist", "view.html");

function planText() {
    return JSON.stringify({
        operator: "result-sink",
        "operator-id": 10,
        "source-marker": "PLAN_雪",
        inputs: [{operator: "scan", type: "native", "operator-id": 11, sqlpos: [[0, 6]]}],
    });
}

async function createHarness() {
    const html = await readFile(htmlPath, "utf8");
    let window;
    const errors = [];
    const requests = [];
    let hostContext = {theme: "light", displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"]};
    const host = {
        postMessage(message) {
            requests.push(message);
            if (message.id === undefined) return;
            queueMicrotask(() => {
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
                } else if (message.method === "ping") {
                    result = {};
                } else {
                    throw new Error(`Unexpected app request: ${message.method}`);
                }
                window.dispatchEvent(
                    new window.MessageEvent("message", {source: host, data: {jsonrpc: "2.0", id: message.id, result}}),
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
            window.Range.prototype.getClientRects = () => [];
            window.Range.prototype.getBoundingClientRect = () => ({
                width: 0,
                height: 0,
                top: 0,
                left: 0,
                bottom: 0,
                right: 0,
                x: 0,
                y: 0,
                toJSON() {},
            });
        },
    });

    const waitFor = (predicate, description) =>
        new Promise((resolve, reject) => {
            const startedAt = Date.now();
            const check = () => {
                if (predicate()) {
                    resolve();
                } else if (Date.now() - startedAt > 5000) {
                    reject(
                        new Error(
                            `Timed out waiting for ${description}. DOM: ${window.document.body.textContent.slice(-1000)} Errors: ${errors.join("\n")}`,
                        ),
                    );
                } else {
                    window.requestAnimationFrame(check);
                }
            };
            check();
        });
    const notify = (method, params) =>
        window.dispatchEvent(new window.MessageEvent("message", {source: host, data: {jsonrpc: "2.0", method, params}}));
    const openPlan = (text, sqlText = null, title = "fixture.plan") => {
        notify("ui/notifications/tool-result", {
            content: [{type: "text", text: "Prepared a query plan for the viewer."}],
            structuredContent: {
                status: "prepared",
                title,
                planBytes: Buffer.byteLength(text),
                sqlBytes: sqlText === null ? 0 : Buffer.byteLength(sqlText),
                hasSql: sqlText !== null,
                format: "hyper",
            },
            _meta: {planText: text, sqlText},
        });
    };
    await waitFor(() => requests.some(({method}) => method === "ui/notifications/initialized"), "MCP Apps initialization");
    return {
        dom,
        errors,
        openPlan,
        notify,
        requests,
        waitFor,
        updateHostContext(update) {
            hostContext = {...hostContext, ...update};
            notify("ui/notifications/host-context-changed", update);
        },
    };
}

test("bundled viewer renders private plan and SQL text and preserves the graph on host changes", async (t) => {
    const harness = await createHarness();
    t.after(() => harness.dom.window.close());
    const {document} = harness.dom.window;
    await harness.waitFor(
        () => document.querySelector(".qg-plugin-status")?.textContent.includes("Paste or drop a query plan"),
        "empty viewer",
    );
    assert.equal(document.querySelectorAll(".react-flow__node").length, 0);

    const plan = planText();
    const sql = "SELECT SOURCE_SQL_π FROM query_table";
    harness.openPlan(plan, sql, "fixture.plan");
    await harness.waitFor(
        () => document.querySelector(".qg-plugin-status")?.textContent === "Loaded hyper query plan (2 nodes).",
        "plan parsing",
    );
    await harness.waitFor(() => document.querySelectorAll(".react-flow__node").length === 2, "graph rendering");

    const planPanel = [...document.querySelectorAll(".graph-text-document-panel")].find(({textContent}) =>
        textContent.includes("Query Plan"),
    );
    const sqlPanel = [...document.querySelectorAll(".graph-text-document-panel")].find(({textContent}) =>
        textContent.includes("Original SQL Query"),
    );
    assert.ok(planPanel);
    assert.ok(sqlPanel);
    planPanel.querySelector(".qg-collapsible-panel-toggle").click();
    sqlPanel.querySelector(".qg-collapsible-panel-toggle").click();
    await harness.waitFor(
        () => planPanel.textContent.includes("PLAN_雪") && sqlPanel.textContent.includes("SOURCE_SQL_π"),
        "plan and SQL source documents",
    );

    const shell = document.getElementById("plugin-shell");
    const displayedNode = document.querySelector(".react-flow__node");
    await harness.waitFor(() => !document.getElementById("display-error").hidden, "inline display feedback");
    harness.updateHostContext({theme: "dark", displayMode: "fullscreen"});
    await harness.waitFor(
        () => shell.dataset.theme === "dark" && document.getElementById("expand").hidden,
        "fullscreen host context",
    );
    assert.equal(document.getElementById("display-error").hidden, true);
    assert.equal(document.querySelectorAll(".react-flow__node").length, 2);
    assert.equal(displayedNode.isConnected, true);

    harness.updateHostContext({displayMode: "inline"});
    await harness.waitFor(() => !document.getElementById("expand").hidden, "inline display mode");
    assert.equal(document.querySelector(".qg-plugin-status")?.textContent, "Loaded hyper query plan (2 nodes).");
    assert.deepEqual(harness.errors, []);
});

test("bundled viewer shows invalid private plan text and clears the prior graph", async (t) => {
    const harness = await createHarness();
    t.after(() => harness.dom.window.close());
    const {document} = harness.dom.window;
    harness.openPlan(planText(), null, "valid.plan");
    await harness.waitFor(() => document.querySelectorAll(".react-flow__node").length === 2, "valid graph");

    harness.openPlan("not valid JSON", null, "invalid.plan");
    await harness.waitFor(
        () => document.querySelector('.qg-plugin-status[role="alert"]')?.textContent.trim(),
        "visible plan parse error",
    );
    assert.equal(document.querySelectorAll(".react-flow__node").length, 0);
    assert.deepEqual(harness.errors, []);
});

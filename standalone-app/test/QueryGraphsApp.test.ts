import assert from "node:assert/strict";
import {registerHooks} from "node:module";
import test from "node:test";
import type {TestContext} from "node:test";
import * as React from "react";
import {createUiFixture} from "../../query-graphs/test/ui-test-utils";

registerHooks({
    load(url, context, nextLoad) {
        if (url.endsWith(".css")) return {format: "module", source: "", shortCircuit: true};
        return nextLoad(url, context);
    },
});

async function withApp(
    context: TestContext,
    url: string,
    run: (fixture: ReturnType<typeof createUiFixture>, fetchCount: () => number) => Promise<void>,
) {
    const fixture = createUiFixture({url, additionalGlobals: ["FileReader"]});
    Object.assign(fixture.dom.window.HTMLTextAreaElement.prototype, {attachEvent() {}, detachEvent() {}});
    const navigation = new fixture.dom.window.EventTarget();
    Object.defineProperty(navigation, "currentEntry", {get: () => ({url: fixture.dom.window.location.href})});
    Object.defineProperty(fixture.dom.window, "navigation", {configurable: true, value: navigation});
    const previousBuildGlobals = new Map(
        ["BUILD_COMMIT_HASH", "BUILD_TIMESTAMP"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
    );
    Object.defineProperty(globalThis, "BUILD_COMMIT_HASH", {configurable: true, value: "test-commit"});
    Object.defineProperty(globalThis, "BUILD_TIMESTAMP", {configurable: true, value: "test-time"});
    let fetchCalls = 0;
    const mock = context.mock.method(globalThis, "fetch", async () => {
        fetchCalls++;
        return new Response("", {status: 404});
    });
    try {
        const {QueryGraphsApp} = await import("../src/QueryGraphsApp");
        await fixture.render(React.createElement(QueryGraphsApp));
        await run(fixture, () => fetchCalls);
    } finally {
        mock.mock.restore();
        await fixture.cleanup();
        for (const [name, descriptor] of previousBuildGlobals) {
            if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
            else Object.defineProperty(globalThis, name, descriptor);
        }
    }
}

test("QueryGraphsApp rejects duplicate URL file references before fetching", async (context) => {
    const cases = [
        ["duplicate named subkeys", "#file%5Bplan.json%5D=plan&file%5Ba.sql%5D=same&file%5Ba.sql%5D=same", "a.sql"],
        ["repeated file alias", "#file=one&file=two", "plan.json"],
        ["repeated sql-file alias", "#file%5Bplan.json%5D=plan&sql-file=one&sql-file=two", "query.sql"],
        ["file alias and named collision", "#file=one&file%5Bplan.json%5D=two", "plan.json"],
        ["sql-file alias and named collision", "#sql-file=one&file%5Bquery.sql%5D=two", "query.sql"],
    ] as const;

    for (const [description, hash, logicalName] of cases) {
        await withApp(context, `https://example.test/${hash}`, async (fixture, fetchCount) => {
            assert.equal(
                fixture.document.querySelector(".load-error")?.textContent,
                `Duplicate file name: ${logicalName}`,
                description,
            );
            assert.equal(fetchCount(), 0, description);

            const params = new URLSearchParams(fixture.dom.window.location.hash.slice(1));
            params.set("title", "edited title");
            await React.act(async () => {
                fixture.dom.window.history.replaceState(null, "", `#${params.toString()}`);
                fixture.dom.window.navigation.dispatchEvent(new fixture.dom.window.Event("currententrychange"));
            });
            assert.equal(
                fixture.document.querySelector(".load-error")?.textContent,
                `Duplicate file name: ${logicalName}`,
                description,
            );
            assert.equal(fetchCount(), 0, description);

            await React.act(async () => {
                fixture.dom.window.history.replaceState(null, "", "#title=edited%20title");
                fixture.dom.window.navigation.dispatchEvent(new fixture.dom.window.Event("currententrychange"));
            });
            assert.equal(fixture.document.querySelector(".load-error"), null, description);
            assert.equal(fetchCount(), 0, description);
        });
    }
});

test("QueryGraphsApp ignores query-only file configuration", async (context) => {
    await withApp(
        context,
        "https://example.test/?file=from-query&sql-file=from-query&file%5Bplan.json%5D=from-query",
        async (fixture, fetchCount) => {
            assert.equal(fixture.document.querySelector(".load-error"), null);
            assert.ok(fixture.document.querySelector(".file-selection-page"));
            assert.equal(fetchCount(), 0);
        },
    );
});

test("title edits do not reload files or clear their loading error", async (context) => {
    await withApp(context, "https://example.test/#file%5Bplan.json%5D=plan.json", async (fixture, fetchCount) => {
        const error = fixture.document.querySelector(".load-error")?.textContent;
        assert.match(error ?? "", /Failed to load plan\.json/);
        assert.equal(fetchCount(), 1);

        await React.act(async () => {
            fixture.dom.window.history.replaceState(null, "", "#file%5Bplan.json%5D=plan.json&title=Renamed");
            fixture.dom.window.navigation.dispatchEvent(new fixture.dom.window.Event("currententrychange"));
        });
        assert.equal(fixture.document.querySelector(".load-error")?.textContent, error);
        assert.equal(fixture.document.title, "Renamed - QueryGraphs");
        assert.equal(fetchCount(), 1);
    });
});

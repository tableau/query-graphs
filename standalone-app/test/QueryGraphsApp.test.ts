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
    respond?: (signal: AbortSignal | undefined, url: string) => Promise<Response>,
) {
    const fixture = createUiFixture({
        url,
        additionalGlobals: [
            "FileReader",
            "Window",
            "Element",
            "HTMLDivElement",
            "SVGElement",
            "requestAnimationFrame",
            "cancelAnimationFrame",
            "getComputedStyle",
            "ResizeObserver",
        ],
    });
    // Layout is not exercised here; let the real graph mount without observing browser geometry.
    Object.defineProperty(globalThis, "ResizeObserver", {
        configurable: true,
        value: class {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    });
    Object.defineProperty(fixture.dom.window, "matchMedia", {
        configurable: true,
        value: () => ({matches: false, addEventListener() {}, removeEventListener() {}}),
    });
    Object.assign(fixture.dom.window.HTMLTextAreaElement.prototype, {attachEvent() {}, detachEvent() {}});
    const navigation = new fixture.dom.window.EventTarget();
    Object.defineProperty(navigation, "currentEntry", {get: () => ({url: fixture.dom.window.location.href})});
    Object.assign(navigation, {
        navigate(url: string, options: {history: "push" | "replace"}) {
            if (options.history === "push") fixture.dom.window.history.pushState(null, "", url);
            else fixture.dom.window.history.replaceState(null, "", url);
            navigation.dispatchEvent(new fixture.dom.window.Event("currententrychange"));
        },
    });
    Object.defineProperty(fixture.dom.window, "navigation", {configurable: true, value: navigation});
    const previousBuildGlobals = new Map(
        ["BUILD_COMMIT_HASH", "BUILD_TIMESTAMP"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
    );
    Object.defineProperty(globalThis, "BUILD_COMMIT_HASH", {configurable: true, value: "test-commit"});
    Object.defineProperty(globalThis, "BUILD_TIMESTAMP", {configurable: true, value: "test-time"});
    let fetchCalls = 0;
    const mock = context.mock.method(globalThis, "fetch", async (...args: Parameters<typeof fetch>) => {
        fetchCalls++;
        if (respond) return respond(args[1]?.signal ?? undefined, String(args[0]));
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

test("invalid URL configuration has a dedicated page and never fetches files", async (context) => {
    const cases = [
        ["duplicate named subkeys", "#file%5Bplan.json%5D=plan&file%5Ba.sql%5D=same&file%5Ba.sql%5D=same", "a.sql"],
        ["repeated file alias", "#file=one&file=two", "plan.json"],
        ["repeated sql-file alias", "#file%5Bplan.json%5D=plan&sql-file=one&sql-file=two", "query.sql"],
        ["file alias and named collision", "#file=one&file%5Bplan.json%5D=two", "plan.json"],
        ["sql-file alias and named collision", "#sql-file=one&file%5Bquery.sql%5D=two", "query.sql"],
        ["repeated title", "#title=one&title=two&file=plan", "title"],
        ["repeated upload server", "#uploadServer=one&uploadServer=two&file=plan", "uploadServer"],
    ] as const;

    for (const [description, hash, logicalName] of cases) {
        await withApp(context, `https://example.test/${hash}`, async (fixture, fetchCount) => {
            assert.equal(fixture.document.querySelector("h1")?.textContent, "Invalid URL", description);
            assert.ok(fixture.document.querySelector(".invalid-url-errors")?.textContent?.includes(logicalName), description);
            assert.equal(fixture.document.querySelector("textarea"), null, description);
            assert.ok(fixture.document.querySelector(".caption"), description);
            assert.ok(fixture.document.querySelector(".landing-footer"), description);
            assert.equal(fetchCount(), 0, description);

            const params = new URLSearchParams(fixture.dom.window.location.hash.slice(1));
            params.set("unrelated", "edited");
            await React.act(async () => {
                fixture.dom.window.history.replaceState(null, "", `#${params.toString()}`);
                fixture.dom.window.navigation.dispatchEvent(new fixture.dom.window.Event("currententrychange"));
            });
            assert.equal(fixture.document.querySelector("h1")?.textContent, "Invalid URL", description);
            assert.ok(fixture.document.querySelector(".invalid-url-errors")?.textContent?.includes(logicalName), description);
            assert.equal(fetchCount(), 0, description);

            await React.act(async () => {
                fixture.dom.window.history.replaceState(null, "", "#title=edited%20title");
                fixture.dom.window.navigation.dispatchEvent(new fixture.dom.window.Event("currententrychange"));
            });
            assert.equal(fixture.document.querySelector(".invalid-url-page"), null, description);
            assert.ok(fixture.document.querySelector("textarea"), description);
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
        const error = fixture.document.querySelector(".loading-errors")?.textContent;
        assert.match(error ?? "", /plan\.json/);
        assert.equal(fetchCount(), 1);

        await React.act(async () => {
            fixture.dom.window.history.replaceState(null, "", "#file%5Bplan.json%5D=plan.json&title=Renamed");
            fixture.dom.window.navigation.dispatchEvent(new fixture.dom.window.Event("currententrychange"));
        });
        assert.equal(fixture.document.querySelector(".loading-errors")?.textContent, error);
        assert.equal(fixture.document.title, "Renamed - QueryGraphs");
        assert.equal(fetchCount(), 1);
    });
});

test("ignoring duplicates keeps the first value and resolves file alias collisions", async (context) => {
    const cases = [
        {hash: "file=first.plan&file[plan.json]=second.plan", key: "file", value: "first.plan", fetches: 1},
        {hash: "file[plan.json]=first.plan&file=second.plan", key: "file[plan.json]", value: "first.plan", fetches: 1},
        {
            hash: "file[plan.json]=plan&sql-file=first.sql&file[query.sql]=second.sql",
            key: "sql-file",
            value: "first.sql",
            fetches: 2,
        },
        {
            hash: "file[plan.json]=plan&file[query.sql]=first.sql&sql-file=second.sql",
            key: "file[query.sql]",
            value: "first.sql",
            fetches: 2,
        },
        {hash: "file[plan.json]=first.plan&file[plan.json]=second.plan", key: "file[plan.json]", value: "first.plan", fetches: 1},
        {
            hash: "file[plan.json]=plan&file[a%0Ab.sql]=first.sql&file[a%0Ab.sql]=second.sql",
            key: "file[a\nb.sql]",
            value: "first.sql",
            fetches: 2,
        },
    ];
    for (const {hash, key, value, fetches} of cases) {
        const url = `https://example.test/path?ignored=query#title=first&${hash}&title=second&uploadServer=first-server&uploadServer=second-server&keep=unique`;
        await withApp(context, url, async (fixture, fetchCount) => {
            assert.equal(fixture.document.querySelector("h1")?.textContent, "Invalid URL");
            assert.equal(fixture.dom.window.location.href, new URL(url).href);
            assert.equal(fetchCount(), 0);
            const historyLength = fixture.dom.window.history.length;
            const ignore = [...fixture.document.querySelectorAll("button")].find(
                (button) => button.textContent === "Ignore duplicate keys",
            );
            assert.ok(ignore);
            assert.equal(ignore.disabled, false);
            await React.act(async () => ignore.click());
            assert.equal(fixture.document.querySelector(".invalid-url-page"), null);
            const params = new URLSearchParams(fixture.dom.window.location.hash.slice(1));
            assert.equal(params.get(key), value);
            assert.equal(params.get("title"), "first");
            assert.equal(params.get("uploadServer"), "first-server");
            assert.equal(params.get("keep"), "unique");
            assert.equal(fixture.dom.window.location.search, "");
            assert.equal(fixture.dom.window.history.length, historyLength);
            assert.equal(fetchCount(), fetches);
            // The mocked 404 remains a resource-loading error, not an invalid-URL page.
            assert.match(fixture.document.querySelector(".loading-errors")?.textContent ?? "", /plan\.json/);
        });
    }
});

test("starting over clears all URL state and returns to a pristine file opener", async (context) => {
    await withApp(
        context,
        "https://example.test/path?ignored=query#file=one&file=two&title=Old&uploadServer=server&other=value",
        async (fixture, fetchCount) => {
            assert.equal(fixture.document.querySelector("h1")?.textContent, "Invalid URL");
            const reset = [...fixture.document.querySelectorAll("button")].find(
                (button) => button.textContent === "Back to main page",
            );
            assert.ok(reset);
            await React.act(async () => reset.click());
            assert.equal(fixture.dom.window.location.href, "https://example.test/path");
            assert.equal(fixture.document.querySelector(".invalid-url-page"), null);
            assert.equal(fixture.document.querySelector(".load-error"), null);
            assert.ok(fixture.document.querySelector("textarea"));
            assert.equal(fixture.document.title, "QueryGraphs");
            assert.equal(fetchCount(), 0);
        },
    );
});

test("invalid main-plan selections offer reset without an ineffective duplicate recovery", async (context) => {
    for (const hash of ["file[notes.txt]=notes", "file[plan.json]=one&file[plan.xml]=two"]) {
        await withApp(context, `https://example.test/#${hash}`, async (fixture, fetchCount) => {
            assert.equal(fixture.document.querySelector("h1")?.textContent, "Invalid URL");
            const buttons = [...fixture.document.querySelectorAll("button")];
            assert.equal(buttons.length, 2);
            assert.equal(buttons.find((button) => button.textContent === "Ignore duplicate keys")?.disabled, true);
            assert.equal(buttons.find((button) => button.textContent === "Back to main page")?.disabled, false);
            assert.equal(fetchCount(), 0);
        });
    }
});

test("an invalid URL aborts an in-flight load and replaces its loading screen", async (context) => {
    let requestedSignal: AbortSignal | undefined;
    await withApp(
        context,
        "https://example.test/#file=plan",
        async (fixture, fetchCount) => {
            assert.equal(fetchCount(), 1);
            assert.ok(requestedSignal);
            assert.equal(requestedSignal.aborted, false);
            await React.act(async () => {
                fixture.dom.window.history.replaceState(null, "", "#file=plan&title=one&title=two");
                fixture.dom.window.navigation.dispatchEvent(new fixture.dom.window.Event("currententrychange"));
            });
            assert.equal(requestedSignal.aborted, true);
            assert.equal(fixture.document.querySelector("h1")?.textContent, "Invalid URL");
            assert.equal(fixture.document.querySelector(".loading-overlay"), null);
            assert.ok(fixture.document.querySelector(".landing-footer"));
            assert.equal(fetchCount(), 1);
        },
        (signal) =>
            new Promise<Response>((_resolve, reject) => {
                assert.ok(signal);
                requestedSignal = signal;
                signal.addEventListener("abort", () => reject(signal.reason), {once: true});
            }),
    );
});

function button(fixture: ReturnType<typeof createUiFixture>, label: string): HTMLButtonElement {
    const result = [...fixture.document.querySelectorAll("button")].find((element) => element.textContent === label);
    assert.ok(result, `Missing button: ${label}`);
    return result;
}

test("loading overlays the same opener and retains its footer", async (context) => {
    let resolve!: (response: Response) => void;
    await withApp(
        context,
        "https://example.test/",
        async (fixture) => {
            const textarea = fixture.document.querySelector("textarea");
            const footer = fixture.document.querySelector(".landing-footer");
            assert.ok(textarea);
            assert.ok(footer);
            await React.act(async () => {
                fixture.dom.window.history.replaceState(null, "", "#file=plan.json");
                fixture.dom.window.navigation.dispatchEvent(new fixture.dom.window.Event("currententrychange"));
            });
            assert.equal(fixture.document.querySelector("textarea"), textarea);
            assert.equal(textarea.disabled, true);
            assert.equal(fixture.document.querySelector(".landing-footer"), footer);
            assert.ok(fixture.document.querySelector(".loading-overlay[role=status]"));
            assert.ok(fixture.document.querySelector(".caption"));
            await React.act(async () => resolve(new Response("", {status: 404})));
            assert.equal(fixture.document.querySelector("h1")?.textContent, "Unable to load files");
            assert.equal(fixture.document.querySelector(".landing-footer"), footer);
            assert.equal(button(fixture, "Ignore unloadable files").disabled, true);
            await React.act(async () => button(fixture, "Back to main page").click());
            assert.ok(fixture.document.querySelector("textarea"));
            assert.equal(fixture.document.querySelector(".landing-footer"), footer);
            assert.equal(fixture.dom.window.location.hash, "");
        },
        () =>
            new Promise<Response>((done) => {
                resolve = done;
            }),
    );
});

test("retry reloads all files and ignoring failures reuses the successful plan", async (context) => {
    const requests: string[] = [];
    await withApp(
        context,
        "https://example.test/#file=main.json&file[ok.log]=ok.log&file[bad.log]=bad.log",
        async (fixture, fetchCount) => {
            assert.equal(fixture.document.querySelector("h1")?.textContent, "Unable to load files");
            assert.match(fixture.document.querySelector(".loading-errors")?.textContent ?? "", /bad.log/);
            assert.equal(fetchCount(), 3);
            assert.equal(button(fixture, "Ignore unloadable files").disabled, false);
            await React.act(async () => button(fixture, "Retry").click());
            assert.equal(fetchCount(), 6);
            for (const name of ["main.json", "ok.log", "bad.log"])
                assert.equal(requests.filter((url) => url.endsWith(name)).length, 2);
            await React.act(async () => button(fixture, "Ignore unloadable files").click());
            assert.equal(fetchCount(), 6);
            assert.equal(fixture.document.querySelector(".loading-errors"), null);
            assert.ok(fixture.document.querySelector(".react-flow"));
            const params = new URLSearchParams(fixture.dom.window.location.hash.slice(1));
            assert.equal(params.has("file[bad.log]"), false);
            assert.equal(params.get("file[ok.log]"), "ok.log");
            assert.equal(params.get("file[plan.json]"), "main.json");
            assert.equal(params.has("file"), false);
        },
        async (_signal, url) => {
            requests.push(url);
            if (url.endsWith("bad.log")) return new Response("", {status: 404});
            return new Response(url.endsWith("main.json") ? '{"operator":"scan"}' : "successful extra file");
        },
    );
});

test("a failed retry can succeed and enter the graph", async (context) => {
    let attempts = 0;
    await withApp(
        context,
        "https://example.test/#file=main.json",
        async (fixture, fetchCount) => {
            assert.equal(fixture.document.querySelector("h1")?.textContent, "Unable to load files");
            assert.equal(button(fixture, "Ignore unloadable files").disabled, true);
            await React.act(async () => button(fixture, "Retry").click());
            assert.equal(fetchCount(), 2);
            assert.ok(fixture.document.querySelector(".react-flow"));
        },
        async () => (++attempts === 1 ? new Response("", {status: 404}) : new Response('{"operator":"scan"}')),
    );
});

test("decompression and plan parsing failures use the loading recovery page", async (context) => {
    const nativeFetch = globalThis.fetch;
    for (const [fileUrl, reason] of [
        ["data:application/gzip;base64,YmFk", /gzip/i],
        ["data:text/plain,not-a-query-plan", /parse/i],
    ] as const) {
        const params = new URLSearchParams([["file[plan.json]", fileUrl]]);
        await withApp(
            context,
            `https://example.test/#${params}`,
            async (fixture) => {
                assert.equal(fixture.document.querySelector("h1")?.textContent, "Unable to load files");
                assert.match(fixture.document.querySelector(".loading-errors")?.textContent ?? "", reason);
                assert.equal(button(fixture, "Ignore unloadable files").disabled, true);
                assert.ok(fixture.document.querySelector(".caption"));
                assert.ok(fixture.document.querySelector(".landing-footer"));
            },
            (signal, url) => nativeFetch(url, {signal}),
        );
    }
});

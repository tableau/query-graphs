import assert from "node:assert/strict";
import test from "node:test";
import {JSDOM} from "jsdom";
import {act, createElement} from "react";
import type React from "react";
import {createRoot} from "react-dom/client";
import type {Root} from "react-dom/client";
import {useBrowserUrl, useUrlParam} from "../src/browserUrlHooks";

interface TestNavigation extends EventTarget {
    currentEntry: {url: string};
    navigate: (url: string, options: {history: "push" | "replace"}) => void;
    navigations: ("push" | "replace")[];
}

async function withBrowser<T>(href: string, run: (navigation: TestNavigation, dom: JSDOM) => Promise<T> | T): Promise<T> {
    const dom = new JSDOM("<!doctype html><body></body>", {url: href});
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const navigation = new EventTarget() as TestNavigation;
    Object.defineProperty(navigation, "currentEntry", {get: () => ({url: dom.window.location.href})});
    navigation.navigations = [];
    navigation.navigate = (url, options) => {
        navigation.navigations.push(options.history);
        if (options.history === "push") dom.window.history.pushState(null, "", url);
        else dom.window.history.replaceState(dom.window.history.state, "", url);
        navigation.dispatchEvent(new Event("currententrychange"));
    };
    Object.defineProperty(dom.window, "navigation", {configurable: true, value: navigation});
    Object.defineProperty(globalThis, "window", {configurable: true, value: dom.window});
    Object.defineProperty(globalThis, "document", {configurable: true, value: dom.window.document});
    try {
        return await run(navigation, dom);
    } finally {
        dom.window.close();
        if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
        else Reflect.deleteProperty(globalThis, "window");
        if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
        else Reflect.deleteProperty(globalThis, "document");
    }
}

test("URL hooks ignore query-only parameters and prefer hash values without rewriting the URL", async () => {
    await withBrowser(
        "https://example.test/path?file=query-file&sql-file=query-sql&title=query-title&uploadServer=query-upload#file=data%3Atext%2Fplain%2Ca%2520b&file=second&keep=a%2Bb&keep=c",
        async (_navigation, dom) => {
            const originalUrl = dom.window.location.href;
            const historyLength = dom.window.history.length;
            const previousActEnvironment = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
            let root: Root | undefined;
            function Harness() {
                const url = useBrowserUrl();
                const [file] = useUrlParam(url, "file");
                const [sqlFile] = useUrlParam(url, "sql-file");
                const [title] = useUrlParam(url, "title");
                const [uploadServer] = useUrlParam(url, "uploadServer");
                const [keep] = useUrlParam(url, "keep");
                return createElement("span", null, JSON.stringify({file, sqlFile, title, uploadServer, keep}));
            }
            Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {configurable: true, value: true});
            try {
                root = createRoot(dom.window.document.body.appendChild(dom.window.document.createElement("div")));
                await act(async () => root?.render(createElement(Harness)));
                const rendered = JSON.parse(dom.window.document.body.textContent ?? "") as Record<string, string | undefined>;
                assert.deepEqual(rendered, {
                    file: "data:text/plain,a%20b",
                    keep: "a+b",
                });
                assert.equal(rendered.sqlFile, undefined);
                assert.equal(rendered.title, undefined);
                assert.equal(rendered.uploadServer, undefined);
                assert.equal(dom.window.location.href, originalUrl);
                assert.equal(dom.window.history.length, historyLength);
            } finally {
                if (root) await act(async () => root.unmount());
                if (previousActEnvironment) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActEnvironment);
                else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
            }
        },
    );
});

test("URL parameter writes stay in the hash and preserve batching and history behavior", async () => {
    await withBrowser(
        "https://example.test/path?file=query-file&sql-file=query-sql&title=query-title&uploadServer=query-upload#keep=1&keep=2&title=old",
        async (navigation, dom) => {
            const historyLength = dom.window.history.length;
            const previousActEnvironment = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
            let root: Root | undefined;
            let titleSetter: React.Dispatch<React.SetStateAction<string | undefined>>;
            let fileSetter: React.Dispatch<React.SetStateAction<string | undefined>>;
            function Harness() {
                const url = useBrowserUrl();
                const [file, setFile] = useUrlParam(url, "file");
                const [title, setTitle] = useUrlParam(url, "title", true);
                titleSetter = setTitle;
                fileSetter = setFile;
                return createElement("span", null, `${file}|${title}`);
            }
            Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {configurable: true, value: true});
            try {
                root = createRoot(dom.window.document.body.appendChild(dom.window.document.createElement("div")));
                await act(async () => root?.render(createElement(Harness)));
                assert.equal(dom.window.document.body.textContent, "undefined|old");

                await act(async () => {
                    titleSetter!("private title");
                    fileSetter!("blob:private");
                    await new Promise((resolve) => queueMicrotask(resolve));
                });
                assert.equal(dom.window.location.search, "");
                assert.equal(dom.window.history.length, historyLength + 1);
                assert.deepEqual(navigation.navigations, ["push"]);
                assert.deepEqual(new URLSearchParams(dom.window.location.hash.slice(1)).getAll("keep"), ["1", "2"]);
                assert.equal(new URLSearchParams(dom.window.location.hash.slice(1)).get("file"), "blob:private");
                assert.equal(new URLSearchParams(dom.window.location.hash.slice(1)).get("title"), "private title");
                assert.doesNotMatch(dom.window.location.href, /query-file|query-sql|query-title|query-upload/);

                await act(async () => {
                    titleSetter!("renamed");
                    await new Promise((resolve) => queueMicrotask(resolve));
                });
                assert.equal(dom.window.location.search, "");
                assert.equal(dom.window.history.length, historyLength + 1);
                assert.deepEqual(navigation.navigations, ["push", "replace"]);
            } finally {
                if (root) await act(async () => root.unmount());
                if (previousActEnvironment) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActEnvironment);
                else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
            }
        },
    );
});

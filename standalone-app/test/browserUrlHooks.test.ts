import assert from "node:assert/strict";
import test from "node:test";
import {act, createElement} from "react";
import type React from "react";
import {createUiFixture} from "../../test/ui-test-utils";
import {useBrowserUrl, useUrlParam} from "../src/browserUrlHooks";

interface TestNavigation extends EventTarget {
    currentEntry: {url: string};
    navigate: (url: string, options: {history: "push" | "replace"}) => void;
    navigations: ("push" | "replace")[];
}

async function withBrowser(
    href: string,
    run: (navigation: TestNavigation, fixture: ReturnType<typeof createUiFixture>) => Promise<void>,
): Promise<void> {
    const fixture = createUiFixture({url: href});
    const {dom} = fixture;
    const navigation = new dom.window.EventTarget() as TestNavigation;
    Object.defineProperty(navigation, "currentEntry", {get: () => ({url: dom.window.location.href})});
    navigation.navigations = [];
    navigation.navigate = (url, options) => {
        navigation.navigations.push(options.history);
        if (options.history === "push") dom.window.history.pushState(null, "", url);
        else dom.window.history.replaceState(dom.window.history.state, "", url);
        navigation.dispatchEvent(new dom.window.Event("currententrychange"));
    };
    Object.defineProperty(dom.window, "navigation", {configurable: true, value: navigation});
    try {
        await run(navigation, fixture);
    } finally {
        await fixture.cleanup();
    }
}

test("URL hooks read only hash parameters without rewriting the URL", async () => {
    await withBrowser(
        "https://example.test/path?file=query-file&sql-file=query-sql&title=query-title&uploadServer=query-upload#file=data%3Atext%2Fplain%2Ca%2520b&file=second&keep=a%2Bb&keep=c",
        async (navigation, fixture) => {
            const originalUrl = fixture.dom.window.location.href;
            const historyLength = fixture.dom.window.history.length;
            let values: Record<string, string | undefined> = {};
            function Harness() {
                const url = useBrowserUrl();
                const [file] = useUrlParam(url, "file");
                const [sqlFile] = useUrlParam(url, "sql-file");
                const [title] = useUrlParam(url, "title");
                const [uploadServer] = useUrlParam(url, "uploadServer");
                const [keep] = useUrlParam(url, "keep");
                values = {file, sqlFile, title, uploadServer, keep};
                return null;
            }
            await fixture.render(createElement(Harness));
            assert.deepEqual(values, {
                file: "data:text/plain,a%20b",
                sqlFile: undefined,
                title: undefined,
                uploadServer: undefined,
                keep: "a+b",
            });
            assert.equal(fixture.dom.window.location.href, originalUrl);
            assert.equal(fixture.dom.window.history.length, historyLength);
            assert.deepEqual(navigation.navigations, []);
        },
    );
});

test("URL parameter writes use the hash and batch push/replace updates", async () => {
    await withBrowser(
        "https://example.test/path?file=query-file&sql-file=query-sql&title=query-title&uploadServer=query-upload#keep=1&keep=2&title=old",
        async (navigation, fixture) => {
            const {dom} = fixture;
            const historyLength = dom.window.history.length;
            let values: Record<string, string | undefined> = {};
            let titleSetter!: React.Dispatch<React.SetStateAction<string | undefined>>;
            let fileSetter!: React.Dispatch<React.SetStateAction<string | undefined>>;
            function Harness() {
                const url = useBrowserUrl();
                const [file, setFile] = useUrlParam(url, "file");
                const [title, setTitle] = useUrlParam(url, "title", true);
                titleSetter = setTitle;
                fileSetter = setFile;
                values = {file, title};
                return null;
            }
            await fixture.render(createElement(Harness));
            assert.deepEqual(values, {file: undefined, title: "old"});

            await act(async () => {
                titleSetter("private title");
                fileSetter("blob:private");
            });
            assert.equal(dom.window.location.search, "");
            assert.equal(dom.window.history.length, historyLength + 1);
            assert.deepEqual(navigation.navigations, ["push"]);
            const params = new URLSearchParams(dom.window.location.hash.slice(1));
            assert.deepEqual(params.getAll("keep"), ["1", "2"]);
            assert.equal(params.get("file"), "blob:private");
            assert.equal(params.get("title"), "private title");
            assert.deepEqual(values, {file: "blob:private", title: "private title"});
            assert.doesNotMatch(dom.window.location.href, /query-file|query-sql|query-title|query-upload/);

            await act(async () => {
                titleSetter("renamed");
            });
            assert.equal(dom.window.location.search, "");
            assert.equal(dom.window.history.length, historyLength + 1);
            assert.deepEqual(navigation.navigations, ["push", "replace"]);
            assert.equal(new URLSearchParams(dom.window.location.hash.slice(1)).get("title"), "renamed");
            assert.deepEqual(values, {file: "blob:private", title: "renamed"});
        },
    );
});

import assert from "node:assert/strict";
import test from "node:test";
import {act, createElement} from "react";
import type React from "react";
import {createUiFixture} from "../../query-graphs/test/ui-test-utils";
import {useBrowserUrl, useUrlMapParam, useUrlParam} from "../src/browserUrlHooks";

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
        "https://example.test/path?file=query-file&sql-file=query-sql&title=query-title&uploadServer=query-upload#file=data%3Atext%2Fplain%2Ca%2520b&keep=a%2Bb&keep=c",
        async (navigation, fixture) => {
            const originalUrl = fixture.dom.window.location.href;
            const historyLength = fixture.dom.window.history.length;
            let values: Record<string, string | undefined> = {};
            let hasDuplicates = false;
            let missingHasDuplicates = true;
            let validHasDuplicates = true;
            function Harness() {
                const url = useBrowserUrl();
                const [file, , fileDuplicates] = useUrlParam(url, "file");
                const [sqlFile] = useUrlParam(url, "sql-file");
                const [title, , titleDuplicates] = useUrlParam(url, "title");
                const [uploadServer] = useUrlParam(url, "uploadServer");
                const [keep, , duplicates] = useUrlParam(url, "keep");
                hasDuplicates = duplicates;
                validHasDuplicates = fileDuplicates;
                missingHasDuplicates = titleDuplicates;
                values = {file, sqlFile, title, uploadServer, keep};
                return null;
            }
            await fixture.render(createElement(Harness));
            assert.deepEqual(values, {
                file: "data:text/plain,a%20b",
                sqlFile: undefined,
                title: undefined,
                uploadServer: undefined,
                keep: undefined,
            });
            assert.equal(hasDuplicates, true);
            assert.equal(validHasDuplicates, false);
            assert.equal(missingHasDuplicates, false);
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
                const [title, setTitle] = useUrlParam(url, "title", {history: "replace"});
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

test("scalar duplicates are invalid and functional updates use the latest pending value", async () => {
    for (const values of ["first&value=second", "same&value=same"]) {
        await withBrowser(`https://example.test/path#value=${values}&keep=1`, async (_navigation, fixture) => {
            let value!: string | undefined;
            let hasDuplicates!: boolean;
            let setter!: React.Dispatch<React.SetStateAction<string | undefined>>;
            function Harness() {
                const url = useBrowserUrl();
                [value, setter, hasDuplicates] = useUrlParam(url, "value");
                return null;
            }
            await fixture.render(createElement(Harness));
            assert.equal(value, undefined);
            assert.equal(hasDuplicates, true);
            await act(async () => {
                setter((previous) => {
                    assert.equal(previous, undefined);
                    return "recovered";
                });
                setter((previous) => `${previous}-again`);
            });
            assert.equal(value, "recovered-again");
            assert.equal(hasDuplicates, false);
            const params = new URLSearchParams(fixture.dom.window.location.hash.slice(1));
            assert.equal(params.get("value"), "recovered-again");
            assert.equal(params.get("keep"), "1");
        });
    }
});

test("title edits preserve distinct and duplicate named file parameters", async () => {
    await withBrowser(
        "https://example.test/path#file%5Ba.sql%5D=first&file%5Ba.sql%5D=second&file%5Bb.sql%5D=third&title=old",
        async (_navigation, fixture) => {
            let titleSetter!: React.Dispatch<React.SetStateAction<string | undefined>>;
            function Harness() {
                const url = useBrowserUrl();
                const [, setTitle] = useUrlParam(url, "title", {history: "replace"});
                titleSetter = setTitle;
                return null;
            }
            await fixture.render(createElement(Harness));
            await act(async () => titleSetter("renamed"));

            const params = new URLSearchParams(fixture.dom.window.location.hash.slice(1));
            assert.deepEqual(params.getAll("file[a.sql]"), ["first", "second"]);
            assert.deepEqual(params.getAll("file[b.sql]"), ["third"]);
            assert.equal(params.get("title"), "renamed");
        },
    );
});

test("batched title and map updates replace aliases in one history entry", async () => {
    await withBrowser(
        "https://example.test/path?title=query-title&uploadServer=query-upload#file=old&file%5Blegacy.sql%5D=old&sql-file=old-query&uploadServer=hash-upload&title=old",
        async (navigation, fixture) => {
            const {dom} = fixture;
            const historyLength = dom.window.history.length;
            let titleSetter!: React.Dispatch<React.SetStateAction<string | undefined>>;
            let filesSetter!: React.Dispatch<React.SetStateAction<ReadonlyMap<string, string> | undefined>>;
            let fileAliasSetter!: React.Dispatch<React.SetStateAction<string | undefined>>;
            let sqlFileSetter!: React.Dispatch<React.SetStateAction<string | undefined>>;
            function Harness() {
                const url = useBrowserUrl();
                const [, setTitle] = useUrlParam(url, "title", {history: "replace"});
                titleSetter = setTitle;
                const [, setFiles] = useUrlMapParam(url, "file");
                filesSetter = setFiles;
                [, fileAliasSetter] = useUrlParam(url, "file", {history: "replace"});
                [, sqlFileSetter] = useUrlParam(url, "sql-file", {history: "replace"});
                return null;
            }
            await fixture.render(createElement(Harness));
            await act(async () => {
                titleSetter("new title");
                fileAliasSetter(undefined);
                sqlFileSetter(undefined);
                filesSetter(new Map([["plan.xml", "blob:new-plan"]]));
            });

            const params = new URLSearchParams(dom.window.location.hash.slice(1));
            assert.equal(params.get("title"), "new title");
            assert.equal(params.get("uploadServer"), "hash-upload");
            assert.equal(params.get("file[plan.xml]"), "blob:new-plan");
            assert.deepEqual(
                [...params.keys()].filter((key) => key === "file" || key === "sql-file" || key.startsWith("file[")),
                ["file[plan.xml]"],
            );
            assert.equal(dom.window.location.search, "");
            assert.equal(dom.window.history.length, historyLength + 1);
            assert.deepEqual(navigation.navigations, ["push"]);
            assert.doesNotMatch(dom.window.location.href, /query-title|query-upload/);
        },
    );
});

test("map parameters read bracketed hash entries, report duplicate names, and ignore query", async () => {
    await withBrowser(
        "https://example.test/path?item[query]=ignored#item=bare&item%5Ba%5D=one&item[y]=first&item%5By%5D=second&item[a]=one&item[a]=one&item%5Bb%20c%5D=three",
        async (_navigation, fixture) => {
            let map: ReadonlyMap<string, string> | undefined;
            let duplicates: readonly string[] = [];
            function Harness() {
                const url = useBrowserUrl();
                [map, , duplicates] = useUrlMapParam(url, "item");
                return null;
            }
            await fixture.render(createElement(Harness));
            assert.equal(map, undefined);
            assert.deepEqual(duplicates, ["y", "a"]);
        },
    );
});

test("map results retain identity across unrelated URL edits", async () => {
    const cases = [
        {hash: "other=1", entries: [], duplicateKeys: []},
        {hash: "item[a]=one&other=1", entries: [["a", "one"]], duplicateKeys: []},
        {hash: "item[a]=one&item[a]=one&other=1", entries: undefined, duplicateKeys: ["a"]},
    ];
    for (const {hash, entries, duplicateKeys} of cases) {
        await withBrowser(`https://example.test/path?item[x]=query#${hash}`, async (_navigation, fixture) => {
            let map!: ReadonlyMap<string, string> | undefined;
            let duplicates!: readonly string[];
            let setTitle!: React.Dispatch<React.SetStateAction<string | undefined>>;
            function Harness() {
                const url = useBrowserUrl();
                [map, , duplicates] = useUrlMapParam(url, "item");
                [, setTitle] = useUrlParam(url, "title", {history: "replace"});
                return null;
            }
            await fixture.render(createElement(Harness));
            assert.deepEqual(map && [...map], entries);
            assert.deepEqual(duplicates, duplicateKeys);
            const firstMap = map;
            const firstDuplicates = duplicates;
            await act(async () => setTitle("after"));
            assert.equal(map, firstMap);
            assert.equal(duplicates, firstDuplicates);
        });
    }
});

test("map updates batch functionally, replace only their group, and recover invalid groups", async () => {
    await withBrowser(
        "https://example.test/path?private=query#item=bare&item%5Bx%5D=one&item[x]=one&item[b%5D%5D=encoded&other%5Bother%5D=keep&keep=1&keep=2",
        async (navigation, fixture) => {
            let setter!: React.Dispatch<React.SetStateAction<ReadonlyMap<string, string> | undefined>>;
            let current!: ReadonlyMap<string, string> | undefined;
            let duplicates!: readonly string[];
            function Harness() {
                const url = useBrowserUrl();
                [current, setter, duplicates] = useUrlMapParam(url, "item", {history: "replace"});
                return null;
            }
            await fixture.render(createElement(Harness));
            assert.equal(current, undefined);
            assert.deepEqual(duplicates, ["x"]);
            await act(async () => {
                setter((value) => {
                    assert.equal(value, undefined);
                    return new Map([["a b", "first"]]);
                });
                setter((value) => new Map([...value!, ["next", "second"]]));
            });
            const params = new URLSearchParams(fixture.dom.window.location.hash.slice(1));
            assert.equal(params.get("item[a b]"), "first");
            assert.equal(params.get("item[next]"), "second");
            assert.equal(params.get("other[other]"), "keep");
            assert.equal(params.get("item"), "bare");
            assert.deepEqual(params.getAll("keep"), ["1", "2"]);
            assert.equal(fixture.dom.window.location.search, "");
            assert.deepEqual(navigation.navigations, ["replace"]);
            assert.deepEqual(duplicates, []);
            assert.deepEqual(
                [...current!],
                [
                    ["a b", "first"],
                    ["next", "second"],
                ],
            );

            await act(async () => setter(undefined));
            const cleared = new URLSearchParams(fixture.dom.window.location.hash.slice(1));
            assert.equal(cleared.has("item[a b]"), false);
            assert.equal(cleared.has("item[next]"), false);
            assert.equal(cleared.get("item"), "bare");
            assert.equal(cleared.get("other[other]"), "keep");
        },
    );
});

test("clearing the last map entry removes the hash and identical updates do not navigate", async () => {
    await withBrowser("https://example.test/path#item[x]=value", async (navigation, fixture) => {
        let map!: ReadonlyMap<string, string> | undefined;
        let setter!: React.Dispatch<React.SetStateAction<ReadonlyMap<string, string> | undefined>>;
        function Harness() {
            const url = useBrowserUrl();
            [map, setter] = useUrlMapParam(url, "item", {history: "replace"});
            return null;
        }
        await fixture.render(createElement(Harness));
        await act(async () => setter(map));
        assert.deepEqual(navigation.navigations, []);
        await act(async () => setter(new Map([["", ""]])));
        assert.equal(map?.has(""), true);
        assert.equal(map?.get(""), "");
        assert.equal(fixture.dom.window.location.hash, "#item%5B%5D=");
        await act(async () => setter(new Map()));
        assert.equal(fixture.dom.window.location.hash, "");
        assert.deepEqual(navigation.navigations, ["replace", "replace"]);
    });
});

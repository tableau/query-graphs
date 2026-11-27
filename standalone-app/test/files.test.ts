import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
    clearFileParameters,
    createFileDocument,
    getFileLanguage,
    getFileReferences,
    loadPlanFromFiles,
    validateFileReferences,
} from "../src/files";

describe("URL files", () => {
    it("reads hash entries only and ignores query entries", () => {
        const url = new URL(
            "https://example.test/?file%5Ba.sql%5D=query-a&file%5Bx.json%5D=query#file%5Ba.sql%5D=hash-a&file%5Ba.sql%5D=hash-b",
        );
        assert.deepEqual(getFileReferences(url), [
            {logicalFilename: "a.sql", url: "hash-a"},
            {logicalFilename: "a.sql", url: "hash-b"},
        ]);
        assert.throws(() => validateFileReferences(getFileReferences(url)), /Duplicate file name: a.sql/);
        assert.deepEqual(getFileReferences(new URL("https://example.test/?file%5Bplan.json%5D=query&file=old&sql-file=q")), []);
    });

    it("normalizes legacy main and SQL aliases before duplicate validation", () => {
        assert.deepEqual(
            getFileReferences(new URL("https://example.test/?file=ignored#file=old.xml&sql-file=sql&file%5Bother.txt%5D=other")),
            [
                {logicalFilename: "plan.json", url: "old.xml"},
                {logicalFilename: "query.sql", url: "sql"},
                {logicalFilename: "other.txt", url: "other"},
            ],
        );
        assert.throws(
            () => validateFileReferences(getFileReferences(new URL("https://example.test/#file=legacy&file%5Bplan.json%5D=named"))),
            /Duplicate file name: plan\.json/,
        );
    });

    it("requires exactly one main plan before fetching any file", async () => {
        const originalFetch = globalThis.fetch;
        let fetches = 0;
        globalThis.fetch = async () => {
            fetches++;
            return new Response("{}", {status: 200});
        };
        try {
            for (const references of [
                [{logicalFilename: "notes.txt", url: "https://example.test/notes.txt"}],
                [
                    {logicalFilename: "plan.json", url: "https://example.test/plan.json"},
                    {logicalFilename: "plan.xml", url: "https://example.test/plan.xml"},
                ],
                getFileReferences(new URL("https://example.test/#file=legacy&file%5Bplan.xml%5D=named")),
            ]) {
                await assert.rejects(
                    loadPlanFromFiles(references, new URL("https://example.test/app"), new AbortController().signal),
                    /No main plan file|Only one main plan/,
                );
            }
            assert.equal(fetches, 0);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("keeps legacy file content autodetection and chooses named XML plans", async () => {
        const {JSDOM} = await import("jsdom");
        const dom = new JSDOM();
        const previousDomParser = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
        Object.defineProperty(globalThis, "DOMParser", {configurable: true, writable: true, value: dom.window.DOMParser});
        const xml = "<default.xml><no-query-file-specified></no-query-file-specified></default.xml>";
        const data = (text: string) => `data:text/plain,${encodeURIComponent(text)}`;
        try {
            const legacy = await loadPlanFromFiles(
                [{logicalFilename: "plan.json", url: data(xml)}],
                new URL("https://example.test/app"),
                new AbortController().signal,
            );
            const named = await loadPlanFromFiles(
                [{logicalFilename: "plan.xml", url: data(xml)}],
                new URL("https://example.test/app"),
                new AbortController().signal,
            );
            assert.equal(legacy.plan.format, "xml");
            assert.equal(named.plan.format, "xml");
        } finally {
            if (previousDomParser === undefined) Reflect.deleteProperty(globalThis, "DOMParser");
            else Object.defineProperty(globalThis, "DOMParser", previousDomParser);
            dom.window.close();
        }
    });

    it("ignores query file entries even when they repeat hash names", () => {
        const fileUrl = new URL("https://example.test/?file%5Ba.sql%5D=one#file%5Ba.sql%5D=two");
        assert.deepEqual(getFileReferences(fileUrl), [{logicalFilename: "a.sql", url: "two"}]);
        assert.doesNotThrow(() => validateFileReferences(getFileReferences(fileUrl)));
    });

    it("keeps identifiers case-sensitive", () => {
        const references = getFileReferences(new URL("https://example.test/#file%5BA.sql%5D=one&file%5Ba.sql%5D=two"));
        assert.doesNotThrow(() => validateFileReferences(references));
    });

    it("infers only SQL and JSON syntax from logical filenames", () => {
        assert.equal(getFileLanguage("dir/QUERY.SQL"), "sql");
        assert.equal(getFileLanguage("query.plan.json"), "json");
        assert.equal(getFileLanguage("query.xml"), undefined);
        assert.deepEqual(createFileDocument({logicalFilename: "unknown.xyz", url: "data:,x"}, "a\r\nb\rc"), {
            id: "file:unknown.xyz",
            title: "unknown.xyz",
            text: "a\nb\nc",
            language: undefined,
        });
    });

    it("clears file parameters while retaining unrelated duplicate parameters", () => {
        const result = clearFileParameters(
            new URL(
                "https://example.test/?title=query&file%5Bx.sql%5D=query#title=plan&title=second&file%5Bx.sql%5D=hash&sql-file=legacy&uploadServer=server",
            ),
        );
        assert.deepEqual(
            [...new URLSearchParams(result.hash.slice(1)).entries()],
            [
                ["title", "plan"],
                ["title", "second"],
                ["uploadServer", "server"],
            ],
        );
        assert.equal(result.search, "");
    });

    it("replaces all file aliases with a canonical named file and preserves app settings", async () => {
        const {setFileReferences} = await import("../src/files");
        const result = setFileReferences(
            new URL(
                "https://example.test/?ignored=query#uploadServer=server&file=old&file%5Bold.txt%5D=old&sql-file=sql&title=Plan",
            ),
            [{logicalFilename: "plan.xml", url: "blob:local"}],
        );
        assert.deepEqual(
            [...new URLSearchParams(result.hash.slice(1)).entries()],
            [
                ["uploadServer", "server"],
                ["title", "Plan"],
                ["file[plan.xml]", "blob:local"],
            ],
        );
    });

    it("loads query SQL with raw UTF-8 byte offsets", async () => {
        const sql = "-- é😀\r\nSELECT target;";
        const targetStart = Buffer.byteLength(sql.slice(0, sql.indexOf("target")));
        const plan = JSON.stringify({operator: "scan", sqlpos: [[targetStart, targetStart + 6]]});
        const data = (text: string) => new URL(`data:text/plain,${encodeURIComponent(text)}`);
        const loaded = await loadPlanFromFiles(
            [
                {logicalFilename: "plan.json", url: data(plan).toString()},
                {logicalFilename: "query.sql", url: data(`${sql}\r\n`).toString()},
            ],
            new URL("https://example.test/app"),
            new AbortController().signal,
        );
        const query = loaded.plan.tree.textDocuments?.find(({id}) => id === "query");
        assert.equal(query?.text, `${sql.replace(/\r\n/g, "\n")}\n`);
        assert.equal(query?.title, "query.sql");
        const targetOffset = query?.text.indexOf("target");
        assert.deepEqual(
            loaded.plan.tree.root.sourceLocations?.find(({documentId}) => documentId === "query"),
            {documentId: "query", from: targetOffset, to: (targetOffset ?? 0) + 6},
        );
        assert.deepEqual(loaded.errors, []);
    });

    it("normalizes the legacy SQL alias and isolates file failures", async () => {
        const plan = JSON.stringify({plan: {operator: "tablescan", operatorId: 1}});
        const data = (text: string) => new URL(`data:text/plain,${encodeURIComponent(text)}`);
        const loaded = await loadPlanFromFiles(
            [
                {logicalFilename: "plan.json", url: data(plan).toString()},
                ...getFileReferences(new URL(`https://example.test/#sql-file=${encodeURIComponent(data("SELECT 1").toString())}`)),
                {logicalFilename: "broken.json", url: "http://["},
            ],
            new URL("https://example.test/app"),
            new AbortController().signal,
        );
        assert.equal(loaded.plan.tree.textDocuments?.find(({id}) => id === "query")?.text, "SELECT 1");
        assert.equal(
            loaded.plan.tree.textDocuments?.find(({id}) => id === "file:broken.json"),
            undefined,
        );
        assert.match(loaded.errors[0]?.message ?? "", /Invalid URL/);
    });

    it("adds JSON, SQL, and unknown files without treating them as graphs", async () => {
        const data = (text: string) => new URL(`data:text/plain,${encodeURIComponent(text)}`);
        const loaded = await loadPlanFromFiles(
            [
                {logicalFilename: "plan.json", url: data(JSON.stringify({operator: "scan"})).toString()},
                {logicalFilename: "explain.plan.json", url: data('{"operator":"other"}').toString()},
                {logicalFilename: "notes.sql", url: data("select 1;").toString()},
                {logicalFilename: "trace.xml", url: data("<plain>").toString()},
            ],
            new URL("https://example.test/app"),
            new AbortController().signal,
        );
        assert.deepEqual(
            loaded.plan.tree.textDocuments?.map(({id, title, language}) => ({id, title, language})),
            [
                {id: "plan", title: "Query Plan", language: "json"},
                {id: "file:explain.plan.json", title: "explain.plan.json", language: "json"},
                {id: "file:notes.sql", title: "notes.sql", language: "sql"},
                {id: "file:trace.xml", title: "trace.xml", language: undefined},
            ],
        );
    });

    it("resolves file URLs against the application URL", async () => {
        const originalFetch = globalThis.fetch;
        const requested: string[] = [];
        globalThis.fetch = async (input) => {
            requested.push(String(input));
            return new Response("{}", {status: 200});
        };
        try {
            const loaded = await loadPlanFromFiles(
                [
                    {logicalFilename: "plan.json", url: "data:text/plain,%7B%22operator%22%3A%22scan%22%7D"},
                    {logicalFilename: "other.json", url: "./files/doc.json"},
                ],
                new URL("https://example.test/app/index.html"),
                new AbortController().signal,
            );
            assert.equal(loaded.plan.tree.textDocuments?.find(({id}) => id === "file:other.json")?.text, "{}");
            assert.equal(requested.at(-1), "https://example.test/app/files/doc.json");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("loads the named plan from a shuffled collection and fetches each file once", async () => {
        const originalFetch = globalThis.fetch;
        const requests: string[] = [];
        globalThis.fetch = async (input) => {
            const url = String(input);
            requests.push(url);
            if (url.endsWith("/other.json")) return new Response('{"operator":"other"}', {status: 200});
            if (url.endsWith("/plan.json")) return new Response('{"operator":"scan"}', {status: 200});
            return new Response("SELECT 1", {status: 200});
        };
        try {
            const loaded = await loadPlanFromFiles(
                [
                    {logicalFilename: "notes.txt", url: "https://example.test/notes.txt"},
                    {logicalFilename: "other.json", url: "https://example.test/other.json"},
                    {logicalFilename: "plan.json", url: "https://example.test/plan.json"},
                ],
                new URL("https://example.test/app"),
                new AbortController().signal,
            );
            const mainPlanText = loaded.plan.tree.textDocuments?.find(({id}) => id === "plan")?.text;
            assert.equal(JSON.parse(mainPlanText ?? "{}").operator, "scan");
            assert.equal(loaded.plan.tree.textDocuments?.find(({id}) => id === "file:other.json")?.text, '{"operator":"other"}');
            assert.deepEqual(requests.sort(), [
                "https://example.test/notes.txt",
                "https://example.test/other.json",
                "https://example.test/plan.json",
            ]);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("reports a failed main plan as a fatal named error", async () => {
        await assert.rejects(
            loadPlanFromFiles(
                [{logicalFilename: "plan.json", url: "http://["}],
                new URL("https://example.test/app"),
                new AbortController().signal,
            ),
            /Failed to load plan\.json: Invalid URL/,
        );
    });

    it("includes the logical filename when main plan parsing fails", async () => {
        await assert.rejects(
            loadPlanFromFiles(
                [{logicalFilename: "plan.xml", url: "data:text/plain,not-a-plan"}],
                new URL("https://example.test/app"),
                new AbortController().signal,
            ),
            /Failed to parse plan\.xml: Invalid query plan/,
        );
    });

    it("rejects cancellation instead of returning stale files", async () => {
        const originalFetch = globalThis.fetch;
        const controller = new AbortController();
        let resolveOtherFile!: (response: Response) => void;
        globalThis.fetch = async (input) => {
            if (String(input).endsWith("/other.json")) {
                return await new Promise<Response>((resolve) => {
                    resolveOtherFile = resolve;
                });
            }
            return new Response('{"operator":"scan"}', {status: 200});
        };
        try {
            const loading = loadPlanFromFiles(
                [
                    {logicalFilename: "plan.json", url: "https://example.test/plan.json"},
                    {logicalFilename: "other.json", url: "https://example.test/other.json"},
                ],
                new URL("https://example.test/app"),
                controller.signal,
            );
            await new Promise((resolve) => setImmediate(resolve));
            controller.abort();
            resolveOtherFile(new Response("{}", {status: 200}));
            await assert.rejects(loading, {name: "AbortError"});
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("keeps embedded SQL when the supplied query file fails", async () => {
        const data = (text: string) => new URL(`data:text/plain,${encodeURIComponent(text)}`);
        const embeddedPlan = JSON.stringify({
            query: {sql: "SELECT embedded"},
            operator: [{name: "seq_scan", children: [], extra_info: {}}],
        });
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (input, init) =>
            String(input).endsWith("/response.sql") ? new Response("plain text", {status: 200}) : originalFetch(input, init);
        let loaded;
        try {
            loaded = await loadPlanFromFiles(
                [
                    {logicalFilename: "plan.json", url: data(embeddedPlan).toString()},
                    ...getFileReferences(new URL("https://example.test/#sql-file=http%3A%2F%2F%5B")),
                    {logicalFilename: "kept.txt", url: "https://example.test/response.sql"},
                ],
                new URL("https://example.test/app"),
                new AbortController().signal,
            );
        } finally {
            globalThis.fetch = originalFetch;
        }
        assert.equal(loaded.plan.tree.textDocuments?.find(({id}) => id === "query")?.text, "SELECT embedded");
        assert.equal(loaded.plan.tree.textDocuments?.find(({id}) => id === "file:kept.txt")?.text, "plain text");
        assert.equal(loaded.plan.tree.textDocuments?.find(({id}) => id === "file:kept.txt")?.language, undefined);
        assert.deepEqual(
            loaded.errors.map(({name}) => name),
            ["query.sql"],
        );
    });

    it("normalizes sql-file to query.sql and rejects aliases before fetching", async () => {
        const alias = getFileReferences(new URL("https://example.test/#sql-file=query.sql"));
        assert.deepEqual(alias, [{logicalFilename: "query.sql", url: "query.sql"}]);
        const originalFetch = globalThis.fetch;
        let fetches = 0;
        globalThis.fetch = async () => {
            fetches++;
            return new Response("{}", {status: 200});
        };
        try {
            for (const refs of [
                getFileReferences(new URL("https://example.test/#sql-file=same&file%5Bquery.sql%5D=same")),
                getFileReferences(new URL("https://example.test/#sql-file=same&sql-file=same")),
            ]) {
                await assert.rejects(
                    loadPlanFromFiles(
                        [{logicalFilename: "plan.json", url: "https://example.test/plan.json"}, ...refs],
                        new URL("https://example.test/app"),
                        new AbortController().signal,
                    ),
                    /Duplicate file name: query\.sql/,
                );
            }
            assert.equal(fetches, 0);
        } finally {
            globalThis.fetch = originalFetch;
        }
        assert.throws(
            () =>
                validateFileReferences(
                    getFileReferences(new URL("https://example.test/#sql-file=query&file%5Bquery.sql%5D=named")),
                ),
            /Duplicate file name: query\.sql/,
        );
        assert.deepEqual(getFileReferences(new URL("https://example.test/?sql-file=query#sql-file=hash")), [
            {logicalFilename: "query.sql", url: "hash"},
        ]);
    });
});

import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
    clearAuxiliaryFileParameters,
    createAuxiliaryFileDocument,
    getAuxiliaryFileLanguage,
    getAuxiliaryFileReferences,
    loadPlanWithAuxiliaryFiles,
    validateAuxiliaryFileReferences,
} from "../src/auxiliaryFiles";

describe("auxiliary URL files", () => {
    it("reads repeated names and lets hash keys override query keys", () => {
        const url = new URL(
            "https://example.test/?file%5Ba.sql%5D=query-a&file%5Bx.json%5D=query#file%5Ba.sql%5D=hash-a&file%5Ba.sql%5D=hash-b",
        );
        assert.deepEqual(getAuxiliaryFileReferences(url), [
            {logicalFilename: "x.json", url: "query"},
            {logicalFilename: "a.sql", url: "hash-a"},
            {logicalFilename: "a.sql", url: "hash-b"},
        ]);
        assert.throws(
            () => validateAuxiliaryFileReferences(getAuxiliaryFileReferences(url)),
            /Duplicate auxiliary file name: a.sql/,
        );
    });

    it("keeps identifiers case-sensitive", () => {
        const references = getAuxiliaryFileReferences(new URL("https://example.test/#file%5BA.sql%5D=one&file%5Ba.sql%5D=two"));
        assert.doesNotThrow(() => validateAuxiliaryFileReferences(references));
    });

    it("infers only SQL and JSON syntax from logical filenames", () => {
        assert.equal(getAuxiliaryFileLanguage("dir/QUERY.SQL"), "sql");
        assert.equal(getAuxiliaryFileLanguage("query.plan.json"), "json");
        assert.equal(getAuxiliaryFileLanguage("query.xml"), undefined);
        assert.deepEqual(createAuxiliaryFileDocument({logicalFilename: "unknown.xyz", url: "data:,x"}, "a\r\nb\rc"), {
            id: "auxiliary:unknown.xyz",
            title: "unknown.xyz",
            text: "a\nb\nc",
            language: undefined,
        });
    });

    it("clears auxiliary file parameters while retaining winning ordinary parameters", () => {
        const result = clearAuxiliaryFileParameters(
            new URL(
                "https://example.test/?title=query&file%5Bx.sql%5D=query#title=plan&file%5Bx.sql%5D=hash&sql-file=legacy&uploadServer=server",
            ),
        );
        assert.deepEqual(
            [...new URLSearchParams(result.hash.slice(1)).entries()],
            [
                ["title", "plan"],
                ["uploadServer", "server"],
            ],
        );
        assert.equal(result.search, "");
    });

    it("loads auxiliary SQL with raw UTF-8 byte offsets", async () => {
        const sql = "-- é😀\r\nSELECT target;";
        const targetStart = Buffer.byteLength(sql.slice(0, sql.indexOf("target")));
        const plan = JSON.stringify({operator: "scan", sqlpos: [[targetStart, targetStart + 6]]});
        const data = (text: string) => new URL(`data:text/plain,${encodeURIComponent(text)}`);
        const loaded = await loadPlanWithAuxiliaryFiles(
            data(plan),
            [{logicalFilename: "query.sql", url: data(`${sql}\r\n`).toString()}],
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

    it("normalizes the legacy SQL alias and isolates auxiliary failures", async () => {
        const plan = JSON.stringify({plan: {operator: "tablescan", operatorId: 1}});
        const data = (text: string) => new URL(`data:text/plain,${encodeURIComponent(text)}`);
        const loaded = await loadPlanWithAuxiliaryFiles(
            data(plan),
            [
                ...getAuxiliaryFileReferences(
                    new URL(`https://example.test/#sql-file=${encodeURIComponent(data("SELECT 1").toString())}`),
                ),
                {logicalFilename: "broken.json", url: "http://["},
            ],
            new URL("https://example.test/app"),
            new AbortController().signal,
        );
        assert.equal(loaded.plan.tree.textDocuments?.find(({id}) => id === "query")?.text, "SELECT 1");
        assert.equal(
            loaded.plan.tree.textDocuments?.find(({id}) => id === "auxiliary:broken.json"),
            undefined,
        );
        assert.match(loaded.errors[0]?.message ?? "", /Invalid URL/);
    });

    it("adds JSON, SQL, and unknown auxiliary files without treating them as graphs", async () => {
        const data = (text: string) => new URL(`data:text/plain,${encodeURIComponent(text)}`);
        const loaded = await loadPlanWithAuxiliaryFiles(
            data(JSON.stringify({operator: "scan"})),
            [
                {logicalFilename: "explain.plan.json", url: data('{"operator":"other"}').toString()},
                {logicalFilename: "notes.sql", url: data("select 1;").toString()},
                {logicalFilename: "plan.xml", url: data("<plain>").toString()},
            ],
            new URL("https://example.test/app"),
            new AbortController().signal,
        );
        assert.deepEqual(
            loaded.plan.tree.textDocuments?.map(({id, title, language}) => ({id, title, language})),
            [
                {id: "plan", title: "Query Plan", language: "json"},
                {id: "auxiliary:explain.plan.json", title: "explain.plan.json", language: "json"},
                {id: "auxiliary:notes.sql", title: "notes.sql", language: "sql"},
                {id: "auxiliary:plan.xml", title: "plan.xml", language: undefined},
            ],
        );
    });

    it("resolves auxiliary file URLs against the application URL", async () => {
        const originalFetch = globalThis.fetch;
        const requested: string[] = [];
        globalThis.fetch = async (input) => {
            requested.push(String(input));
            return new Response("{}", {status: 200});
        };
        try {
            const loaded = await loadPlanWithAuxiliaryFiles(
                new URL("data:text/plain,%7B%22operator%22%3A%22scan%22%7D"),
                [{logicalFilename: "other.json", url: "./files/doc.json"}],
                new URL("https://example.test/app/index.html"),
                new AbortController().signal,
            );
            assert.equal(loaded.plan.tree.textDocuments?.find(({id}) => id === "auxiliary:other.json")?.text, "{}");
            assert.equal(requested.at(-1), "https://example.test/app/files/doc.json");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("rejects cancellation instead of returning stale auxiliary files", async () => {
        const originalFetch = globalThis.fetch;
        const controller = new AbortController();
        let resolveAuxiliaryFile!: (response: Response) => void;
        globalThis.fetch = async (input) => {
            if (String(input).endsWith("/auxiliary.json")) {
                return await new Promise<Response>((resolve) => {
                    resolveAuxiliaryFile = resolve;
                });
            }
            return new Response('{"operator":"scan"}', {status: 200});
        };
        try {
            const loading = loadPlanWithAuxiliaryFiles(
                new URL("https://example.test/plan.json"),
                [{logicalFilename: "other.json", url: "https://example.test/auxiliary.json"}],
                new URL("https://example.test/app"),
                controller.signal,
            );
            await new Promise((resolve) => setImmediate(resolve));
            controller.abort();
            resolveAuxiliaryFile(new Response("{}", {status: 200}));
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
            loaded = await loadPlanWithAuxiliaryFiles(
                data(embeddedPlan),
                [
                    ...getAuxiliaryFileReferences(new URL("https://example.test/#sql-file=http%3A%2F%2F%5B")),
                    {logicalFilename: "kept.txt", url: "https://example.test/response.sql"},
                ],
                new URL("https://example.test/app"),
                new AbortController().signal,
            );
        } finally {
            globalThis.fetch = originalFetch;
        }
        assert.equal(loaded.plan.tree.textDocuments?.find(({id}) => id === "query")?.text, "SELECT embedded");
        assert.equal(loaded.plan.tree.textDocuments?.find(({id}) => id === "auxiliary:kept.txt")?.text, "plain text");
        assert.equal(loaded.plan.tree.textDocuments?.find(({id}) => id === "auxiliary:kept.txt")?.language, undefined);
        assert.deepEqual(
            loaded.errors.map(({name}) => name),
            ["query.sql"],
        );
    });

    it("normalizes sql-file to query.sql and rejects aliases before fetching", async () => {
        const alias = getAuxiliaryFileReferences(new URL("https://example.test/#sql-file=query.sql"));
        assert.deepEqual(alias, [{logicalFilename: "query.sql", url: "query.sql"}]);
        const conflicts = [
            "https://example.test/#sql-file=same&file%5Bquery.sql%5D=same",
            "https://example.test/?sql-file=same#file%5Bquery.sql%5D=same",
            "https://example.test/?file%5Bquery.sql%5D=same#sql-file=same",
        ];
        const originalFetch = globalThis.fetch;
        let fetches = 0;
        globalThis.fetch = async () => {
            fetches++;
            return new Response("{}", {status: 200});
        };
        try {
            for (const refs of [
                ...conflicts.map((url) => getAuxiliaryFileReferences(new URL(url))),
                getAuxiliaryFileReferences(new URL("https://example.test/#sql-file=same&sql-file=same")),
            ]) {
                await assert.rejects(
                    loadPlanWithAuxiliaryFiles(
                        new URL("https://example.test/plan.json"),
                        refs,
                        new URL("https://example.test/app"),
                        new AbortController().signal,
                    ),
                    /Duplicate auxiliary file name: query\.sql/,
                );
            }
            assert.equal(fetches, 0);
        } finally {
            globalThis.fetch = originalFetch;
        }
        assert.throws(
            () =>
                validateAuxiliaryFileReferences(
                    getAuxiliaryFileReferences(new URL("https://example.test/?sql-file=query&file%5Bquery.sql%5D=named")),
                ),
            /Duplicate auxiliary file name: query\.sql/,
        );
        assert.deepEqual(getAuxiliaryFileReferences(new URL("https://example.test/?sql-file=query#sql-file=hash")), [
            {logicalFilename: "query.sql", url: "hash"},
        ]);
    });
});

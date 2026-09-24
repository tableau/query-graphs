import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {createExampleLink, mapPlansToSqlFiles, type ExamplesIndex} from "../webpack/example-queries";

test("example index associates generated plans with their SQL files", () => {
    const index = JSON.parse(readFileSync("standalone-app/examples/index.json", "utf8")) as ExamplesIndex;
    const sqlFiles = mapPlansToSqlFiles(index);
    const planCount = Object.values(index.engines).reduce(
        (count, engine) =>
            count + Object.values(engine.queries).reduce((subtotal, modes) => subtotal + Object.keys(modes).length, 0),
        0,
    );

    assert.equal(sqlFiles.size, planCount);
    assert.equal(sqlFiles.get("postgres/tpch/tpch-q2-analyze.plan.json"), "examples/postgres/tpch/tpch-q2-analyze.sql");
    assert.deepEqual(index.engines.postgres.queries["tpch/tpch-q2"].analyze, {
        plan: "postgres/tpch/tpch-q2-analyze.plan.json",
        sql: "postgres/tpch/tpch-q2-analyze.sql",
    });
});

test("example links include SQL when it is available", () => {
    const link = createExampleLink(
        "examples/postgres/tpch/tpch-q2-analyze.plan.json",
        "tpch-q2-analyze.plan.json",
        "examples/postgres/tpch/tpch-q2-analyze.sql",
    );
    const url = new URL(link, "https://example.com/");

    assert.equal(url.searchParams.get("file"), "examples/postgres/tpch/tpch-q2-analyze.plan.json");
    assert.equal(url.searchParams.get("title"), "tpch-q2-analyze.plan.json");
    assert.equal(url.searchParams.get("sql-file"), "examples/postgres/tpch/tpch-q2-analyze.sql");
    assert.equal(new URL(createExampleLink("examples/tests/error.json", "error.json"), url).searchParams.has("sql-file"), false);
});

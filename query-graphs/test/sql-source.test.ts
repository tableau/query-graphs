import assert from "node:assert/strict";
import test from "node:test";
import {createSqlSourceLocator} from "../src/loaders";

test("SQL source locations map UTF-8 byte offsets to normalized UTF-16 offsets", () => {
    const source = createSqlSourceLocator("aé😀\r\nb\rc");

    assert.equal(source.document.text, "aé😀\nb\nc");
    assert.deepEqual(source.fromUtf8Bytes(1, 7), {documentId: "query", from: 1, to: 4});
    assert.deepEqual(source.fromUtf8Bytes(7, 9), {documentId: "query", from: 4, to: 5});
    assert.deepEqual(source.fromUtf8Bytes(9, 12), {documentId: "query", from: 5, to: 8});
    assert.equal(source.fromUtf8Bytes(7, 8), undefined);
});

test("SQL source locations reject invalid and non-boundary UTF-8 byte offsets", () => {
    const source = createSqlSourceLocator("aé😀");

    for (const range of [
        [-1, 1],
        [2, 3],
        [3, 3],
        [0, 100],
        [0.5, 1],
    ]) {
        assert.equal(source.fromUtf8Bytes(range[0], range[1]), undefined);
    }
});

test("SQL source locations match TextEncoder semantics for unpaired surrogates", () => {
    const source = createSqlSourceLocator("\ud800x");

    assert.deepEqual(source.fromUtf8Bytes(0, 3), {documentId: "query", from: 0, to: 1});
    assert.deepEqual(source.fromUtf8LineColumns(1, 1, 1, 4), {documentId: "query", from: 0, to: 1});
});

test("SQL source locations map one-based UTF-8 line and column ranges", () => {
    const source = createSqlSourceLocator("é😀 first\r\nsecond target");

    assert.deepEqual(source.fromUtf8LineColumns(1, 1, 1, 7), {
        documentId: "query",
        from: 0,
        to: 3,
    });
    assert.deepEqual(source.fromUtf8LineColumns(1, 3, 2, 7), {
        documentId: "query",
        from: 1,
        to: 16,
    });
    assert.equal(source.fromUtf8LineColumns(1, 2, 1, 3), undefined);
    assert.equal(source.fromUtf8LineColumns(3, 1, 3, 2), undefined);

    const sourceWithTrailingLine = createSqlSourceLocator("a\n");
    assert.deepEqual(sourceWithTrailingLine.fromUtf8LineColumns(1, 1, 2, 1), {
        documentId: "query",
        from: 0,
        to: 2,
    });
    assert.equal(sourceWithTrailingLine.fromUtf8LineColumns(1, 1, 1, 3), undefined);
});

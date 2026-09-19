import assert from "node:assert/strict";
import test from "node:test";
import {findSqlFolds} from "../src/SqlFolding";

test("folds multiline parentheses", () => {
    const text = "SELECT (\n  foo\n)";
    assert.deepEqual(findSqlFolds(text).get(0), {from: 8, to: 15});
});

test("ignores parentheses in quoted and commented text", () => {
    const text = "SELECT '(\n)'\n-- (\n-- )\n/* (\n) */";
    const folds = findSqlFolds(text);
    assert.equal(folds.has(0), false);
    assert.equal(folds.has(13), false);
    assert.deepEqual(folds.get(23), {from: 25, to: 30});
});

test("folds multiline block comments", () => {
    const text = "SELECT /* heading\n * details\n */ 1";
    assert.deepEqual(findSqlFolds(text).get(0), {from: 9, to: 30});
});

test("folds runs of line comments but not isolated line comments", () => {
    const text = "-- first\n  -- second\n-- third\nSELECT 1\n-- isolated";
    const folds = findSqlFolds(text);
    assert.deepEqual(folds.get(0), {from: 8, to: 29});
    assert.equal(folds.has(39), false);
});

test("does not fold two consecutive line comments", () => {
    const text = "-- first\n-- second\nSELECT 1";
    assert.equal(findSqlFolds(text).has(0), false);
});

test("folds three line comments separated by Windows line endings", () => {
    const text = "-- first\r\n-- second\r\n-- third\r\nSELECT 1";
    assert.deepEqual(findSqlFolds(text).get(0), {from: 8, to: 29});
});

test("does not treat comment-like text inside strings or block comments as line comments", () => {
    const text = "SELECT 'first\n-- second\n-- third'\n/* first\n-- second\n-- third\n*/";
    const folds = findSqlFolds(text);
    assert.equal(folds.has(14), false);
    assert.equal(folds.has(45), false);
});

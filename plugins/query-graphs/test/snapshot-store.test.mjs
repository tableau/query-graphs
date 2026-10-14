import assert from "node:assert/strict";
import test from "node:test";
import {SnapshotError, SnapshotStore} from "../src/snapshot-store.mjs";

test("snapshots copy plan and SQL bytes and expire after idle time", () => {
    let now = 100;
    const snapshots = new SnapshotStore({now: () => now, ttlMs: 50});
    const plan = Buffer.from("plan before open");
    const sql = Buffer.from("select 1");
    const snapshot = snapshots.create("fixture.plan", plan, sql);
    plan.fill(0);
    sql.fill(0);

    const planChunk = snapshots.readChunk(snapshot.handle, "plan", 0, 4);
    const sqlChunk = snapshots.readChunk(snapshot.handle, "sql", 0, 9);
    assert.equal(Buffer.from(planChunk.base64, "base64").toString(), "plan");
    assert.equal(Buffer.from(sqlChunk.base64, "base64").toString(), "select 1");

    now += 51;
    assert.throws(() => snapshots.readChunk(snapshot.handle, "plan", 0, 1), /expired/);
});

test("the snapshot LRU evicts the least recently used plan and its paired SQL", () => {
    let now = 0;
    const snapshots = new SnapshotStore({now: () => now++, ttlMs: 10_000});
    const first = snapshots.create("first", Buffer.from("plan-a"), Buffer.from("sql-a"));
    const second = snapshots.create("second", Buffer.from("plan-b"), Buffer.from("sql-b"));
    snapshots.readChunk(first.handle, "sql", 0, 1);
    const third = snapshots.create("third", Buffer.from("plan-c"));

    assert.throws(() => snapshots.readChunk(second.handle, "plan", 0, 1), /invalid, expired, or evicted/);
    assert.equal(Buffer.from(snapshots.readChunk(first.handle, "plan", 0, 6).base64, "base64").toString(), "plan-a");
    assert.equal(Buffer.from(snapshots.readChunk(third.handle, "plan", 0, 6).base64, "base64").toString(), "plan-c");
});

test("snapshots enforce the per-file byte bound", () => {
    const snapshots = new SnapshotStore();
    assert.throws(() => snapshots.create("large", Buffer.alloc(64 * 1024 * 1024 + 1)), SnapshotError);
    assert.throws(
        () => snapshots.create("pair", Buffer.alloc(64 * 1024 * 1024), Buffer.alloc(64 * 1024 * 1024 + 1)),
        SnapshotError,
    );
    assert.throws(() => snapshots.readChunk("missing", "plan", 0, 1), /invalid, expired, or evicted/);
});

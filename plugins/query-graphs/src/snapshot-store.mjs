import {randomUUID} from "node:crypto";
import {MAX_CHUNK_BYTES, MAX_FILE_BYTES, MAX_RETAINED_BYTES, MAX_RETAINED_SNAPSHOTS, SNAPSHOT_TTL_MS} from "./limits.mjs";

export class SnapshotError extends Error {}

export class SnapshotStore {
    #entries = new Map();
    #retainedBytes = 0;
    #now;
    #ttlMs;

    constructor({now = Date.now, ttlMs = SNAPSHOT_TTL_MS} = {}) {
        this.#now = now;
        this.#ttlMs = ttlMs;
    }

    create(title, planBytes, sqlBytes) {
        if (!(planBytes instanceof Uint8Array) || (sqlBytes !== undefined && !(sqlBytes instanceof Uint8Array))) {
            throw new SnapshotError("Snapshot data must be byte arrays.");
        }
        const sqlSizeBytes = sqlBytes?.byteLength ?? 0;
        if (planBytes.byteLength > MAX_FILE_BYTES || sqlSizeBytes > MAX_FILE_BYTES) {
            throw new SnapshotError(`Each file must be at most ${MAX_FILE_BYTES} bytes.`);
        }
        const totalBytes = planBytes.byteLength + sqlSizeBytes;
        if (totalBytes > MAX_RETAINED_BYTES) throw new SnapshotError("The plan and SQL pair exceeds the retained snapshot limit.");

        const now = this.#now();
        this.#removeExpired(now);
        while (this.#entries.size >= MAX_RETAINED_SNAPSHOTS || this.#retainedBytes + totalBytes > MAX_RETAINED_BYTES) {
            this.#evictLeastRecentlyUsed();
        }

        const handle = randomUUID();
        const entry = {
            title,
            plan: Buffer.from(planBytes),
            sql: sqlBytes === undefined ? undefined : Buffer.from(sqlBytes),
            lastAccess: now,
        };
        this.#entries.set(handle, entry);
        this.#retainedBytes += totalBytes;
        return {handle, title, planBytes: entry.plan.length, sqlBytes: entry.sql?.length ?? 0};
    }

    readChunk(handle, document, offset, length) {
        const entry = this.#entries.get(handle);
        if (!entry) throw new SnapshotError("Snapshot handle is invalid, expired, or evicted; reopen the plan.");
        const now = this.#now();
        if (now - entry.lastAccess > this.#ttlMs) {
            this.#remove(handle);
            throw new SnapshotError("Snapshot handle has expired; reopen the plan.");
        }
        if (document !== "plan" && document !== "sql") throw new SnapshotError("Document must be 'plan' or 'sql'.");
        const bytes = document === "plan" ? entry.plan : entry.sql;
        if (!bytes) throw new SnapshotError("This snapshot has no SQL document.");
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > bytes.length) {
            throw new SnapshotError("Chunk offset is outside the snapshot.");
        }
        if (!Number.isSafeInteger(length) || length < 1 || length > MAX_CHUNK_BYTES) {
            throw new SnapshotError(`Chunk length must be between 1 and ${MAX_CHUNK_BYTES} bytes.`);
        }

        entry.lastAccess = now;
        const end = Math.min(bytes.length, offset + length);
        const chunk = bytes.subarray(offset, end);
        return {offset, length: chunk.length, totalBytes: bytes.length, base64: chunk.toString("base64")};
    }

    #removeExpired(now) {
        for (const [handle, entry] of this.#entries) {
            if (now - entry.lastAccess > this.#ttlMs) this.#remove(handle);
        }
    }

    #evictLeastRecentlyUsed() {
        let oldestHandle;
        let oldestAccess = Infinity;
        for (const [handle, entry] of this.#entries) {
            if (entry.lastAccess < oldestAccess) {
                oldestHandle = handle;
                oldestAccess = entry.lastAccess;
            }
        }
        if (oldestHandle !== undefined) this.#remove(oldestHandle);
    }

    #remove(handle) {
        const entry = this.#entries.get(handle);
        if (!entry) return;
        this.#retainedBytes -= entry.plan.length + (entry.sql?.length ?? 0);
        this.#entries.delete(handle);
    }
}

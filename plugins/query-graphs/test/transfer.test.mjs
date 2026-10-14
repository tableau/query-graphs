import assert from "node:assert/strict";
import test from "node:test";
import {MAX_CHUNK_BYTES} from "../src/limits.mjs";
import {readDocumentText} from "../src/transfer.mjs";

function chunkedServer(bytes, modify = (chunk) => chunk) {
    return {
        async callServerTool({arguments: args}) {
            const data = Buffer.from(bytes).subarray(args.offset, args.offset + args.length);
            return {
                structuredContent: modify({
                    offset: args.offset,
                    length: data.length,
                    totalBytes: bytes.length,
                    base64: data.toString("base64"),
                }),
            };
        },
    };
}

test("plan transfer reconstructs bytes before decoding split UTF-8 sequences", async () => {
    const expected = `${"a".repeat(MAX_CHUNK_BYTES - 2)}☃ trailing text`;
    const bytes = new TextEncoder().encode(expected);
    const actual = await readDocumentText(chunkedServer(bytes), "handle", "plan", bytes.length);
    assert.equal(actual, expected);
});

test("plan transfer honors the chunk size negotiated by the server", async () => {
    const bytes = new TextEncoder().encode("abcdefghij");
    const server = chunkedServer(bytes);
    const requests = [];
    const callServerTool = server.callServerTool.bind(server);
    server.callServerTool = (args) => {
        requests.push(args.arguments.length);
        return callServerTool(args);
    };
    assert.equal(await readDocumentText(server, "handle", "plan", bytes.length, 3), "abcdefghij");
    assert.deepEqual(requests, [3, 3, 3, 1]);
});

test("plan transfer rejects mismatched ranges, short chunks, and invalid UTF-8", async () => {
    const bytes = new TextEncoder().encode("valid plan text");
    await assert.rejects(
        readDocumentText(
            chunkedServer(bytes, (chunk) => ({...chunk, offset: chunk.offset + 1})),
            "handle",
            "plan",
            bytes.length,
        ),
        /inconsistent chunk metadata/,
    );
    await assert.rejects(
        readDocumentText(
            chunkedServer(bytes, (chunk) => ({...chunk, length: chunk.length - 1})),
            "handle",
            "plan",
            bytes.length,
        ),
        /inconsistent chunk metadata/,
    );
    await assert.rejects(readDocumentText(chunkedServer([0xff]), "handle", "plan", 1), /not valid UTF-8/);
});

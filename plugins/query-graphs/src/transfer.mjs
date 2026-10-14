import {MAX_CHUNK_BYTES, MAX_FILE_BYTES} from "./limits.mjs";

export function resultData(result) {
    if (result?.isError) {
        const message = result.content?.find((item) => item.type === "text")?.text;
        throw new Error(message || "The MCP tool call failed.");
    }
    if (result?.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
    const text = result?.content?.find((item) => item.type === "text")?.text;
    if (!text) throw new Error("The MCP tool returned no chunk data.");
    return JSON.parse(text);
}

function decodeBase64(value) {
    if (typeof value !== "string") throw new Error("The MCP tool returned no chunk bytes.");
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    if (btoa(binary) !== value) throw new Error("The MCP tool returned invalid base64 data.");
    return bytes;
}

export async function readDocumentText(app, handle, document, totalBytes, chunkBytes = MAX_CHUNK_BYTES) {
    if (!Number.isSafeInteger(totalBytes) || totalBytes < 0 || totalBytes > MAX_FILE_BYTES) {
        throw new Error("The MCP tool returned an invalid file size.");
    }
    if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > MAX_CHUNK_BYTES) {
        throw new Error("The MCP tool returned an invalid chunk size.");
    }
    const output = new Uint8Array(totalBytes);
    let offset = 0;
    while (offset < totalBytes) {
        const length = Math.min(chunkBytes, totalBytes - offset);
        const result = await app.callServerTool({name: "read_plan_chunk", arguments: {handle, document, offset, length}});
        const chunk = resultData(result);
        const expectedLength = Math.min(length, totalBytes - offset);
        if (chunk.offset !== offset || chunk.totalBytes !== totalBytes || chunk.length !== expectedLength) {
            throw new Error("The MCP tool returned inconsistent chunk metadata.");
        }
        const bytes = decodeBase64(chunk.base64);
        if (bytes.length !== chunk.length || offset + bytes.length > totalBytes) {
            throw new Error("The MCP tool returned an invalid chunk length.");
        }
        output.set(bytes, offset);
        offset += bytes.length;
    }
    try {
        return new TextDecoder("utf-8", {fatal: true}).decode(output);
    } catch (error) {
        throw new Error("The plan snapshot is not valid UTF-8 text.", {cause: error});
    }
}

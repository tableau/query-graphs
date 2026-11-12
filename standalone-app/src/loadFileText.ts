import {isLocalStorageURL, loadLocalStorageURL} from "./LocalStorageUrl";

export async function loadFileText(fileUrl: URL, signal: AbortSignal): Promise<string> {
    if (isLocalStorageURL(fileUrl)) return loadLocalStorageURL(fileUrl);

    let response;
    try {
        response = await fetch(fileUrl, {signal});
    } catch (e) {
        if (fileUrl.protocol == "blob:") {
            throw new Error("Local content no longer accessible", {cause: e});
        }
        throw e;
    }
    if (!response.ok) {
        throw new Error(`Failed to load ${fileUrl}: HTTP ${response.status}`);
    }
    const mediaType = response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
    if (fileUrl.protocol === "data:" && mediaType === "application/gzip") {
        return readEmbeddedGzip(response, signal);
    }
    return response.text();
}

export async function readEmbeddedGzip(response: Response, signal: AbortSignal): Promise<string> {
    if (typeof DecompressionStream === "undefined") {
        throw new Error("This browser does not support gzip decompression.");
    }
    if (response.body === null) {
        throw new Error("The embedded gzip file has no data.");
    }

    const sizeError = new Error("The embedded gzip file exceeds the decompressed size limit of 1 GiB.");
    let decompressedBytes = 0;
    // Limit decompression expansion to reduce the risk of exhausting browser-tab memory.
    const maxDecompressedBytes = 1024 * 1024 * 1024;
    const sizeLimitStream = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            decompressedBytes += chunk.byteLength;
            if (decompressedBytes > maxDecompressedBytes) {
                throw sizeError;
            }
            controller.enqueue(chunk);
        },
    });

    try {
        const decompressed = response.body
            .pipeThrough(new DecompressionStream("gzip"), {signal})
            .pipeThrough(sizeLimitStream, {signal});
        return await new Response(decompressed).text();
    } catch (error) {
        if (signal.aborted || error === sizeError) throw error;
        throw new Error("Unable to decompress the embedded gzip file. The data may be corrupted or incomplete.", {cause: error});
    }
}

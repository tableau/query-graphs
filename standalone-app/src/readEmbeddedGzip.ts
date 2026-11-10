// Limit decompression expansion to reduce the risk of exhausting browser-tab memory.
const maxDecompressedBytes = 1024 * 1024 * 1024;

export async function readEmbeddedGzip(response: Response, signal: AbortSignal): Promise<string> {
    if (typeof DecompressionStream === "undefined") {
        throw new Error("This browser does not support gzip decompression.");
    }
    if (response.body === null) {
        throw new Error("The embedded gzip file has no data.");
    }

    const sizeError = new Error("The embedded gzip file exceeds the decompressed size limit of 1 GiB.");
    let decompressedBytes = 0;
    const sizeLimit = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            decompressedBytes += chunk.byteLength;
            if (decompressedBytes > maxDecompressedBytes) {
                throw sizeError;
            }
            controller.enqueue(chunk);
        },
    });

    try {
        const decompressed = response.body.pipeThrough(new DecompressionStream("gzip"), {signal}).pipeThrough(sizeLimit, {signal});
        return await new Response(decompressed).text();
    } catch (error) {
        if (signal.aborted || error === sizeError) throw error;
        throw new Error("Unable to decompress the embedded gzip file. The data may be corrupted or incomplete.", {cause: error});
    }
}

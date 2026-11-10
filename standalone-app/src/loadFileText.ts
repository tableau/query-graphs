import {isLocalStorageURL, loadLocalStorageURL} from "./LocalStorageUrl";
import {readEmbeddedGzip} from "./readEmbeddedGzip";

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

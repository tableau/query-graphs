import {assert} from "./assert";

const localStorageProtocol = "local:";

function getRandomSlug() {
    const slugDigits = 4;
    const randomId = Math.floor(Math.random() * Math.pow(256, slugDigits));
    return randomId.toString(16).padStart(slugDigits + 1, "0");
}

export function isLocalStorageURL(url: URL): boolean {
    return url.protocol == localStorageProtocol;
}

/**
 * Try to replace the URL by a new URL backed by local storage.
 */
export function tryCreateLocalStorageUrl(content: string): URL | undefined {
    try {
        const slug = getRandomSlug();
        const localStorageKey = "file-" + slug;
        localStorage.setItem(localStorageKey, content);
        return new URL(localStorageProtocol + slug);
    } catch (e) {
        console.log("Failed to create localstorage URL", e);
        return undefined;
    }
}

export function loadLocalStorageURL(url: URL): string {
    assert(isLocalStorageURL(url));
    const slug = url.pathname;
    const localStorageKey = "file-" + slug;
    if (!localStorage) {
        throw new Error("Local storage not available");
    }
    const item = localStorage.getItem(localStorageKey);
    if (item === null) {
        throw new Error("Unable to load file from local cache");
    }
    return item;
}

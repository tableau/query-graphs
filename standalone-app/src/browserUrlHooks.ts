// `prettier` does not yet support `import type`

import type React from "react";
import {useCallback, useEffect, useState} from "react";

type URLState = [URL, (value: React.SetStateAction<URL>, noHistoryEntry?: boolean) => void];

export function useBrowserUrl(): URLState {
    const [url, setUrlInternal] = useState<URL>(() => new URL(window.location.toString()));
    useEffect(() => {
        const listener = (_e: PopStateEvent) => {
            setUrlInternal(new URL(window.location.toString()));
        };
        window.addEventListener("popstate", listener);
        return () => window.removeEventListener("popstate", listener);
    }, [setUrlInternal]);
    const setUrl = useCallback(
        (action: React.SetStateAction<URL>, noHistoryEntry?: boolean) => {
            let newUrl: URL;
            if (action instanceof Function) newUrl = action(url);
            else newUrl = action;
            setUrlInternal(newUrl);
            // Don't change the URL if the parameter didn't change.
            // This is important to ensure the history stays intact.
            if (newUrl.toString() != new URL(window.location.toString()).toString()) {
                if (noHistoryEntry) {
                    window.history.replaceState(null, "", newUrl);
                } else {
                    window.history.pushState(null, "", newUrl);
                }
            }
        },
        [url, setUrlInternal],
    );
    return [url, setUrl];
}

// Generate URLSearchParams from the URL hash and the URL search params,
// with the hash params taking precedence
function generateUrlSearchParams(url: URL): URLSearchParams {
    // Use a clone of the URLSearchParams to avoid mutating the original URLSearchParams
    const params = new URLSearchParams(url.search);
    const hashParams = new URLSearchParams(url.hash.slice(1));
    hashParams.forEach((value, key) => {
        params.set(key, value);
    });
    return params;
}

export function useUrlParam(
    urlState: URLState,
    key: string,
    noHistoryEntry?: boolean,
): [string | undefined, React.Dispatch<React.SetStateAction<string | undefined>>] {
    const [url, setUrl] = urlState;
    const searchParams = generateUrlSearchParams(url);
    const v = searchParams.get(key) ?? undefined;
    const set = useCallback(
        (action: React.SetStateAction<string | undefined>) => {
            setUrl((url) => {
                const searchParams = generateUrlSearchParams(url);
                const currentValue = searchParams.get(key) ?? undefined;
                let newValue: string | undefined;
                if (action instanceof Function) newValue = action(currentValue);
                else newValue = action;
                const newURL = new URL(url);
                if (newValue === undefined) {
                    searchParams.delete(key);
                } else {
                    searchParams.set(key, newValue);
                }
                // Delete all search parameters and move them to the hash to avoid
                // sending unnecessary data to the server
                newURL.search = "";
                newURL.hash = `#${searchParams.toString()}`;
                return newURL;
            }, noHistoryEntry);
        },
        [setUrl, key, noHistoryEntry],
    );
    return [v, set];
}

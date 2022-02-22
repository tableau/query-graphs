// `prettier` does not yet support `import type`
// eslint-disable-next-line prettier/prettier
import type React from "react";
import {useCallback, useEffect, useState} from "react";

type URLState = [URL, React.Dispatch<React.SetStateAction<URL>>];

export function useBrowserUrl() : URLState {
    const [url, setUrl] = useState<URL>(() => new URL(window.location.toString()));
    useEffect(() => {
        const listener = (_e: PopStateEvent) => {
            setUrl(new URL(window.location.toString()));
        };
        window.addEventListener("popstate", listener);
        return () => window.removeEventListener("popstate", listener);
    }, [setUrl]);
    useEffect(() => {
        if (url.toString() != new URL(window.location.toString()).toString()) {
            window.history.pushState(null, "", url);
        }
    }, [url]);
    return [url, setUrl];
}

export function useUrlParam(urlState: URLState, key: string): [string | undefined, React.Dispatch<React.SetStateAction<string | undefined>>] {
    const [url, setUrl] = urlState;
    const v = url.searchParams.get(key) ?? undefined;
    const set = useCallback((action: React.SetStateAction<string | undefined>) => {
        setUrl((url) => {
            const currentValue = url.searchParams.get(key) ?? undefined;
            let newValue : string | undefined;
            if (action instanceof Function)
                newValue = action(currentValue);
            else
                newValue = action;
            if (newValue === currentValue) {
                // Don't change the URL if the parameter didn't change.
                // This is important to ensure the history stays intact.
                return url;
            }
            const newURL = new URL(url);
            if (newValue === undefined) {
                newURL.searchParams.delete(key);
            } else {
                newURL.searchParams.set(key, newValue);
            }
            return newURL;
        });
    }, [setUrl, key]);
    return [v, set];
}
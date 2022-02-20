import {useCallback, useEffect, useState} from "react";

export function useUrlParam(key: string): [string | undefined, (v: string | undefined) => void] {
    const [v, setRaw] = useState<string | undefined>(() => {
        const params = new URLSearchParams(window.location.search);
        return params.get(key) ?? undefined;
    });
    const set = useCallback(
        (newValue: string | undefined) => {
            const url = new URL(window.location.toString());
            if (newValue === url.searchParams.get(key)) {
                // Don't change the URL if the parameter didn't change.
                // This is important to ensure the history stays intact.
                return;
            }
            if (newValue === undefined) {
                url.searchParams.delete(key);
            } else {
                url.searchParams.set(key, newValue);
            }
            window.history.pushState(null, "", url);
            setRaw(newValue);
        },
        [setRaw, key],
    );
    useEffect(() => {
        const listener = function(_e: PopStateEvent) {
            const params = new URLSearchParams(window.location.search);
            const pv = params.get(key) ?? undefined;
            if (v != pv) setRaw(pv);
        };
        window.addEventListener("popstate", listener);
        return () => window.removeEventListener("popstate", listener);
    }, [v, key]);
    return [v, set];
}

// Hash parameters override query parameters by key; repeated entries in the winning source survive.
export function mergeUrlParameters(url: URL): URLSearchParams {
    const params = new URLSearchParams();
    const hashParams = new URLSearchParams(url.hash.slice(1));
    const hashKeys = new Set<string>();
    hashParams.forEach((_value, key) => hashKeys.add(key));
    new URLSearchParams(url.search).forEach((value, key) => {
        if (!hashKeys.has(key)) params.append(key, value);
    });
    hashParams.forEach((value, key) => params.append(key, value));
    return params;
}

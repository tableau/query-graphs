// Try to convert to string. Return undefined if not succesful.
export function tryToString(d: unknown): string | undefined {
    if (typeof d === "string") {
        return d;
    } else if (typeof d === "number") {
        return d.toString();
    } else if (typeof d === "boolean") {
        return d.toString();
    } else if (d === null) {
        return "null";
    } else if (d === undefined) {
        return "undefined";
    }
    return undefined;
}

// Convert to string. Returns the JSON serialization if not supported.
export function forceToString(d) {
    let str = tryToString(d);
    if (str === undefined) {
        str = JSON.stringify(d);
    }
    return str;
}

export function json2stringmap(json: string): Map<string, string> {
    let parsedJSON;
    try {
        parsedJSON = JSON.parse(json);
    } catch (err) {
        throw new Error("JSON parse failed with '" + err + "'.");
    }
    if (typeof parsedJSON !== "object") {
        throw new Error("Expected a JSON object, got " + typeof parsedJSON);
    }
    const result = new Map<string, string>();
    for (const key of Object.keys(parsedJSON)) {
        const value = parsedJSON[key];
        const strValue = tryToString(value);
        if (strValue === undefined) {
            throw new Error("Expected a string value, got " + typeof value);
        }
        result.set(key, value);
    }
    return result;
}

// Format a number using metric suffixes
export function formatMetric(x) {
    const sizes = ["", "k", "M", "G", "T", "P", "E", "Z", "Y"];
    let idx = 0;
    while (x > 1000 && idx < sizes.length - 1) {
        x /= 1000;
        ++idx;
    }
    return x.toFixed(0) + sizes[idx];
}

export function assert(value: boolean): asserts value {
    if (!value) {
        // eslint-disable-next-line no-debugger
        debugger;
        throw new Error("Assertion violated");
    }
}

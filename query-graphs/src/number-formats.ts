export type NumberFormat = "rounded" | "exact" | "memory-bytes" | "time-seconds";

export function formatNumber(value: number, format: NumberFormat | undefined): string {
    switch (format) {
        case "rounded":
            return formatCount(value);
        case "exact":
            return formatExact(value);
        case "memory-bytes":
            return formatBytes(value);
        case "time-seconds":
            return formatSeconds(value);
        case undefined:
            return value.toString();
    }
}

export function formatMetric(value: number): string {
    const sizes = ["", "k", "M", "G", "T", "P", "E", "Z", "Y"];
    let index = 0;
    while (value > 1000 && index < sizes.length - 1) {
        value /= 1000;
        index++;
    }
    return value.toFixed(0) + sizes[index];
}

function formatCount(value: number): string {
    const sizes = ["", "K", "M", "B", "T"];
    let index = 0;
    while (Math.abs(value) >= 1000 && index < sizes.length - 1) {
        value /= 1000;
        index++;
    }
    let rounded = index === 0 ? Number(value.toPrecision(3)) : Math.abs(value) < 100 ? Number(value.toFixed(1)) : Math.round(value);
    if (Math.abs(rounded) >= 1000 && index < sizes.length - 1) {
        rounded = Math.sign(rounded);
        index++;
    }
    return rounded.toString() + sizes[index];
}

function formatBytes(bytes: number): string {
    const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
    let value = bytes;
    let index = 0;
    while (Math.abs(value) >= 1024 && index < units.length - 1) {
        value /= 1024;
        index++;
    }
    if (index > 0 && Math.abs(Number(value.toFixed(1))) >= 1024 && index < units.length - 1) {
        value /= 1024;
        index++;
    }
    return `${index === 0 ? value.toString() : value.toFixed(1)} ${units[index]}`;
}

function formatSeconds(seconds: number): string {
    const units: [string, number][] = [
        ["µs", 1e-6],
        ["ms", 1e-3],
        ["s", 1],
        ["min", 60],
        ["h", 3600],
    ];
    let index = 0;
    while (index < units.length - 1 && Math.abs(seconds) >= units[index + 1][1]) index++;
    let rounded = Number((seconds / units[index][1]).toPrecision(3));
    if (index < units.length - 1 && Math.abs(rounded) * units[index][1] >= units[index + 1][1]) {
        rounded = Number(((rounded * units[index][1]) / units[index + 1][1]).toPrecision(3));
        index++;
    }
    return `${rounded}${units[index][0]}`;
}

function formatExact(value: number): string {
    return value.toLocaleString("en-US", {maximumFractionDigits: 20});
}

const otherUnits = ["ns", "us", "ms", "kb", "mb", "gb", "kib", "mib", "gib"];

function nameWords(name: string): string[] {
    return name.split(/[^a-zA-Z]+|(?<=[a-z])(?=[A-Z])/).map((word) => word.toLowerCase());
}

export function inferNumberFormat(name: string): NumberFormat | undefined {
    const words = nameWords(name);
    if (otherUnits.some((unit) => words.includes(unit))) return undefined;
    const wordSet = new Set(words);
    if (wordSet.has("rows") || wordSet.has("cycles")) return "rounded";
    if (wordSet.has("memory") || wordSet.has("bytes")) return "memory-bytes";
    if (wordSet.has("time") || wordSet.has("elapsed") || wordSet.has("clock") || wordSet.has("seconds")) return "time-seconds";
    return undefined;
}

export function numberFormatForProperty(name: string, accepted?: readonly NumberFormat[]): NumberFormat | undefined {
    const inferred = inferNumberFormat(name);
    return inferred !== undefined && accepted?.includes(inferred) ? inferred : undefined;
}

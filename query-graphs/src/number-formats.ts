// How a numeric property is presented to the user.
export type NumberFormat =
    // As an exact number with thousand separators. Use this for values that must never be rounded, such as identifiers.
    | "exact"
    // As an approximate number, using "K" (thousand), "M" (million), "B" (billion), etc. suffixes.
    | "count"
    // As a memory unit ("KiB", "MiB", ...). The value is measured in bytes.
    | "memory-bytes"
    // PostgreSQL reports memory in kB, meaning 1024 bytes.
    | "memory-kilobytes"
    // As a time unit ("850µs", "12ms", "3.5s", "2.1min"). The value is measured in seconds.
    | "time-seconds"
    | "time-milliseconds"
    | "time-microseconds";

export function formatNumber(value: number, format: NumberFormat): string {
    if (!Number.isFinite(value)) return String(value);
    switch (format) {
        case "exact":
            return formatExact(value);
        case "count":
            return formatCount(value);
        case "memory-bytes":
            return formatBytes(value);
        case "memory-kilobytes":
            return formatBytes(value * 1024);
        case "time-seconds":
            return formatSeconds(value);
        case "time-milliseconds":
            return formatSeconds(value / 1000);
        case "time-microseconds":
            return formatSeconds(value / 1_000_000);
    }
}

// Format a number exactly, with thousand separators and every fraction digit.
export function formatExact(value: number): string {
    return value.toLocaleString("en-US", {maximumSignificantDigits: 21});
}

// Format a count using count suffixes (K/M/B/T for thousand, million,
// billion, trillion) rather than the metric `G`. Scaled values below 100 keep
// one decimal (`1.2B`), while unscaled values keep three significant digits.
export function formatCount(value: number): string {
    const sizes = ["", "K", "M", "B", "T"];
    let index = 0;
    while (Math.abs(value) >= 1000 && index < sizes.length - 1) {
        value /= 1000;
        index++;
    }
    let rounded = index === 0 ? Number(value.toPrecision(3)) : Math.abs(value) < 100 ? Number(value.toFixed(1)) : Math.round(value);
    // Rounding may carry into the next unit (999,950 -> "1000K" -> "1M").
    if (Math.abs(rounded) >= 1000 && index < sizes.length - 1) {
        rounded = Math.sign(rounded);
        index++;
    }
    return rounded.toString() + sizes[index];
}

// Format a byte count in binary units (KiB/MiB/GiB), as memory sizes usually are.
export function formatBytes(bytes: number): string {
    const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
    let value = bytes;
    let index = 0;
    while (Math.abs(value) >= 1024 && index < units.length - 1) {
        value /= 1024;
        index++;
    }
    // Rounding may carry into the next unit (1023.96 KiB -> "1024.0 KiB" -> "1.0 MiB").
    if (index > 0 && Math.abs(Number(value.toFixed(1))) >= 1024 && index < units.length - 1) {
        value /= 1024;
        index++;
    }
    return `${index === 0 ? value.toString() : value.toFixed(1)} ${units[index]}`;
}

// Format a duration given in seconds with three significant digits in the
// largest fitting unit (`8.51µs`, `20.9ms`, `1.5s`, `2.5min`, `1.2h`).
export function formatSeconds(seconds: number): string {
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
    // Rounding may carry into the next unit (999.6ms -> "1000ms" -> "1s", 59.96s -> "60s" -> "1min").
    if (index < units.length - 1 && Math.abs(rounded) * units[index][1] >= units[index + 1][1]) {
        rounded = Number(((rounded * units[index][1]) / units[index + 1][1]).toPrecision(3));
        index++;
    }
    return `${rounded}${units[index][0]}`;
}

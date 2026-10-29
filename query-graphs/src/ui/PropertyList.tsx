import type {ReactElement} from "react";
import type {PropertyEntry} from "../tree-description";
import {formatNumber} from "../number-formats";
import "./PropertyList.css";

function formatPropertyValue(property: PropertyEntry): string {
    return typeof property.value === "number" ? formatNumber(property.value, property.numberFormat) : String(property.value);
}

export function PropertyList({properties}: {properties?: Map<string, PropertyEntry>}): ReactElement[] {
    const entries: ReactElement[] = [];
    for (const [key, value] of properties ?? []) {
        entries.push(
            <div key={key}>
                <span className="qg-prop-name">{key}:</span> <span className="qg-prop-value">{formatPropertyValue(value)}</span>
            </div>,
        );
    }
    return entries;
}

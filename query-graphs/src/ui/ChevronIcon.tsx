import cc from "classcat";
import "./ChevronIcon.css";

export function ChevronIcon({expanded, size = "compact"}: {expanded: boolean; size?: "compact" | "regular"}) {
    return (
        <svg
            className={cc(["qg-chevron-icon", {"qg-chevron-icon-regular": size === "regular"}])}
            data-expanded={expanded ? "" : undefined}
            viewBox="0 0 16 16"
            aria-hidden="true"
        >
            <path d="M5.5 3.5 10.5 8l-5 4.5" />
        </svg>
    );
}

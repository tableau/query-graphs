import "./ChevronIcon.css";

export function ChevronIcon({expanded}: {expanded: boolean}) {
    return (
        <svg className="qg-chevron-icon" data-expanded={expanded ? "" : undefined} viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5.5 3.5 10.5 8l-5 4.5" />
        </svg>
    );
}

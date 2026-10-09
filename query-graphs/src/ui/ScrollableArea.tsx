import type {ReactNode} from "react";
import cc from "classcat";
import "./ScrollableArea.css";

export interface ScrollableAreaProps {
    children: ReactNode;
    className?: string;
}

function ScrollOverflowIndicator({direction}: {direction: "above" | "below"}) {
    return (
        <div className={cc(["qg-scroll-overflow-indicator", `qg-scroll-overflow-indicator-${direction}`])} aria-hidden="true">
            <svg viewBox="0 0 16 16">
                <path d={direction === "above" ? "M4 8l4-4 4 4M4 12l4-4 4 4" : "M4 4l4 4 4-4M4 8l4 4 4-4"} />
            </svg>
        </div>
    );
}

export function ScrollableArea({children, className}: ScrollableAreaProps) {
    return (
        <div className={cc(["qg-scrollable-area", className])}>
            <ScrollOverflowIndicator direction="above" />
            <div className="qg-scrollable-area-content">{children}</div>
            <ScrollOverflowIndicator direction="below" />
        </div>
    );
}

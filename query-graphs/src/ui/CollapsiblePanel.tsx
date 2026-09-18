import type {ReactNode} from "react";
import "./CollapsiblePanel.css";

export interface CollapsiblePanelProps {
    title: ReactNode;
    children: ReactNode;
    highlighted?: boolean;
    className?: string;
}

export function CollapsiblePanel({title, children, highlighted, className}: CollapsiblePanelProps) {
    const classes = ["qg-collapsible-panel", highlighted ? "qg-highlighted" : undefined, className]
        .filter((value) => value !== undefined)
        .join(" ");

    return (
        <details className={classes}>
            <summary>
                <span className="qg-collapsible-panel-chevron" aria-hidden="true">
                    &#x25B8;
                </span>
                <span>{title}</span>
                {highlighted ? (
                    <span className="qg-collapsible-panel-highlight" role="img" aria-label="Needs attention">
                        !
                    </span>
                ) : null}
            </summary>
            <div className="qg-collapsible-panel-content">{children}</div>
        </details>
    );
}

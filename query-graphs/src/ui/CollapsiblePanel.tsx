import type {ReactNode} from "react";
import cc from "classcat";
import "./CollapsiblePanel.css";

export interface CollapsiblePanelProps {
    title: ReactNode;
    children: ReactNode;
    highlighted?: boolean;
    className?: string;
}

export function CollapsiblePanel({title, children, highlighted, className}: CollapsiblePanelProps) {
    const classes = cc(["qg-collapsible-panel", {"qg-highlighted": highlighted}, className]);

    return (
        <details className={classes}>
            <summary>
                <span className="qg-collapsible-panel-chevron" aria-hidden="true">
                    &#x25B8;
                </span>
                <span>{title}</span>
                {highlighted ? (
                    <span className="qg-attention-needed-icon" role="img" aria-label="Needs attention">
                        !
                    </span>
                ) : null}
            </summary>
            <div className="qg-collapsible-panel-content">{children}</div>
        </details>
    );
}

import type {ReactNode} from "react";
import cc from "classcat";
import "./CollapsiblePanel.css";

export interface CollapsiblePanelProps {
    title: ReactNode;
    headerActions?: ReactNode;
    children: ReactNode;
    highlighted?: boolean;
    className?: string;
    onToggle?: (open: boolean) => void;
}

export function CollapsiblePanel({title, headerActions, children, highlighted, className, onToggle}: CollapsiblePanelProps) {
    const classes = cc(["qg-collapsible-panel", {"qg-highlighted": highlighted}, className]);

    return (
        <details className={classes} onToggle={(event) => onToggle?.(event.currentTarget.open)}>
            <summary>
                <span className="qg-collapsible-panel-chevron" aria-hidden="true">
                    &#x25B8;
                </span>
                <span className="qg-collapsible-panel-title">{title}</span>
                {highlighted ? (
                    <span className="qg-attention-needed-icon" role="img" aria-label="Needs attention">
                        !
                    </span>
                ) : null}
                {headerActions ? (
                    <span className="qg-collapsible-panel-actions" onClick={(event) => event.stopPropagation()}>
                        {headerActions}
                    </span>
                ) : null}
            </summary>
            <div className="qg-collapsible-panel-content">{children}</div>
        </details>
    );
}

import {useState, type ReactNode} from "react";
import cc from "classcat";
import "./CollapsiblePanel.css";

export interface CollapsiblePanelProps {
    title: ReactNode;
    headerActions?: ReactNode;
    children: ReactNode;
    highlighted?: boolean;
    className?: string;
    mountContentOnFirstOpen?: boolean;
}

export function CollapsiblePanel({
    title,
    headerActions,
    children,
    highlighted,
    className,
    mountContentOnFirstOpen,
}: CollapsiblePanelProps) {
    const classes = cc(["qg-collapsible-panel", {"qg-highlighted": highlighted}, className]);
    const [wasOpened, setWasOpened] = useState(false);

    return (
        <details
            className={classes}
            onToggle={(event) => {
                if (mountContentOnFirstOpen && event.currentTarget.open) setWasOpened(true);
            }}
        >
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
            {!mountContentOnFirstOpen || wasOpened ? <div className="qg-collapsible-panel-content">{children}</div> : null}
        </details>
    );
}

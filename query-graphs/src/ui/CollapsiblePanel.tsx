import {useState, type ReactNode} from "react";
import cc from "classcat";
import "./CollapsiblePanel.css";

export interface CollapsiblePanelProps {
    /** Content displayed in the header. */
    title: ReactNode;
    /** Controls displayed at the end of the header line; available also without toggling the panel. */
    headerActions?: ReactNode;
    /** Content displayed in the panel body. */
    children: ReactNode;
    /** Whether to draw attention to the panel. */
    highlighted?: boolean;
    /** Additional class name applied to the root details element. */
    className?: string;
    /**
     * Delays mounting the panel body until hover, keyboard focus, or opening indicates that it will be needed.
     * Once mounted, the body remains mounted across subsequent close/open cycles.
     */
    mountContentOnFirstIntent?: boolean;
}

export function CollapsiblePanel({
    title,
    headerActions,
    children,
    highlighted,
    className,
    mountContentOnFirstIntent,
}: CollapsiblePanelProps) {
    const classes = cc(["qg-collapsible-panel", {"qg-highlighted": highlighted}, className]);
    const [contentMounted, setContentMounted] = useState(false);

    const mountContent = () => {
        if (mountContentOnFirstIntent) setContentMounted(true);
    };

    return (
        <details
            className={classes}
            onToggle={(event) => {
                if (!event.currentTarget.open) return;
                mountContent();
            }}
        >
            <summary onPointerEnter={mountContent} onFocus={mountContent}>
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
            {!mountContentOnFirstIntent || contentMounted ? <div className="qg-collapsible-panel-content">{children}</div> : null}
        </details>
    );
}

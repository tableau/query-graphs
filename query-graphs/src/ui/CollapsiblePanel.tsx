import {useId, useState, type ReactNode} from "react";
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
    /** Additional class name applied to the panel root. */
    className?: string;
    /** Controls whether the panel is expanded. Omit to let the panel manage its own state. */
    open?: boolean;
    /** Receives expansion changes requested through the disclosure button. */
    onOpenChange?: (open: boolean) => void;
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
    open,
    onOpenChange,
    mountContentOnFirstIntent,
}: CollapsiblePanelProps) {
    const classes = cc(["qg-collapsible-panel", {"qg-highlighted": highlighted}, className]);
    const [contentMounted, setContentMounted] = useState(open === true);
    const [internalOpen, setInternalOpen] = useState(false);
    const contentId = useId();
    const controlled = open !== undefined;
    const expanded = open ?? internalOpen;

    // Remember a programmatic expansion as intent too, so lazy content stays mounted after it is collapsed again.
    if (mountContentOnFirstIntent && expanded && !contentMounted) setContentMounted(true);

    const mountContent = () => {
        if (mountContentOnFirstIntent) setContentMounted(true);
    };

    return (
        <div className={classes} data-expanded={expanded ? "" : undefined}>
            <button
                type="button"
                className="qg-collapsible-panel-toggle"
                aria-expanded={expanded}
                aria-controls={contentId}
                onClick={() => {
                    const nextOpen = !expanded;
                    if (nextOpen) mountContent();
                    if (!controlled) setInternalOpen(nextOpen);
                    onOpenChange?.(nextOpen);
                }}
                onPointerEnter={mountContent}
                onFocus={mountContent}
            >
                <svg className="qg-collapsible-panel-chevron" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M5.5 3.5 10.5 8l-5 4.5" />
                </svg>
                <span className="qg-collapsible-panel-title">{title}</span>
                {highlighted ? (
                    <span className="qg-attention-needed-icon" role="img" aria-label="Needs attention">
                        !
                    </span>
                ) : null}
            </button>
            {headerActions ? (
                <span className="qg-collapsible-panel-actions" role="group" aria-label="Panel actions">
                    {headerActions}
                </span>
            ) : null}
            <div id={contentId} className="qg-collapsible-panel-content" hidden={!expanded}>
                {!mountContentOnFirstIntent || contentMounted || expanded ? children : null}
            </div>
        </div>
    );
}

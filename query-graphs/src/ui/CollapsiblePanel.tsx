import {useEffect, useId, useState, type ReactNode} from "react";
import cc from "classcat";
import {ChevronIcon} from "./ChevronIcon";
import "./PanelSurface.css";
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
    /** Whether collapsed panel content contains the current linked highlight. */
    containsHighlightedContent?: boolean;
    /** Additional class name applied to the panel root. */
    className?: string;
    /** Controls whether the panel is expanded. Omit to let the panel manage its own state; do not add or remove it later. */
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
    containsHighlightedContent,
    className,
    open,
    onOpenChange,
    mountContentOnFirstIntent,
}: CollapsiblePanelProps) {
    const classes = cc(["qg-collapsible-panel", "qg-panel-surface", {"qg-highlighted": highlighted}, className]);
    const [contentMounted, setContentMounted] = useState(open === true);
    const [internalOpen, setInternalOpen] = useState(false);
    // Choose the source of truth once; switching between controlled and uncontrolled state produces ambiguous behavior.
    const [isControlled] = useState(() => open !== undefined);
    const isControlledNow = open !== undefined;
    const contentId = useId();
    const expanded = isControlled ? open === true : internalOpen;

    useEffect(() => {
        if (isControlled !== isControlledNow)
            console.error("CollapsiblePanel must not switch between controlled and uncontrolled state.");
    }, [isControlled, isControlledNow]);

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
                    if (!isControlled) setInternalOpen(nextOpen);
                    onOpenChange?.(nextOpen);
                }}
                onPointerEnter={mountContent}
                onFocus={mountContent}
            >
                <ChevronIcon expanded={expanded} />
                <span className="qg-collapsible-panel-title">
                    {title}
                    <span
                        className={cc([
                            "qg-panel-highlight-indicator",
                            containsHighlightedContent && "qg-panel-highlight-indicator-active",
                        ])}
                        aria-hidden="true"
                    />
                </span>
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

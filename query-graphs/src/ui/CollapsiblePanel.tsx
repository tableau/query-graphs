import {useRef, useState, type ReactNode} from "react";
import cc from "classcat";
import "./CollapsiblePanel.css";

export interface CollapsiblePanelProps {
    /** Content displayed in the panel summary. */
    title: ReactNode;
    /** Controls displayed at the end of the summary without toggling the panel. */
    headerActions?: ReactNode;
    /** Content displayed in the panel body. */
    children: ReactNode;
    /** Whether to draw attention to the panel. */
    highlighted?: boolean;
    /** Additional class name applied to the root details element. */
    className?: string;
    /**
     * Delays mounting the panel body until it is opened for the first time.
     * Once mounted, the body remains mounted across subsequent close/open cycles.
     */
    mountContentOnFirstOpen?: boolean;
    /**
     * Called once when hover, keyboard focus, or opening indicates that the user is likely to need the content.
     * This can be used to preload deferred content without mounting it while the panel is closed.
     */
    onContentIntent?: () => void;
}

export function CollapsiblePanel({
    title,
    headerActions,
    children,
    highlighted,
    className,
    mountContentOnFirstOpen,
    onContentIntent,
}: CollapsiblePanelProps) {
    const classes = cc(["qg-collapsible-panel", {"qg-highlighted": highlighted}, className]);
    const [wasOpened, setWasOpened] = useState(false);
    const contentIntentSignaled = useRef(false);

    const signalContentIntent = () => {
        if (contentIntentSignaled.current || onContentIntent === undefined) return;
        contentIntentSignaled.current = true;
        onContentIntent();
    };

    return (
        <details
            className={classes}
            onToggle={(event) => {
                if (!event.currentTarget.open) return;
                signalContentIntent();
                if (mountContentOnFirstOpen) setWasOpened(true);
            }}
        >
            <summary onPointerEnter={signalContentIntent} onFocus={signalContentIntent}>
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

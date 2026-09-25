import {useEffect, useRef, useState} from "react";
import cc from "classcat";
import {IconButton} from "./IconButton";

export interface CopyButtonProps {
    text: string;
    contentName: string;
    className?: string;
}

type CopyStatus = "copying" | "copied" | "failed";

interface CopyFeedback {
    status: CopyStatus;
    text: string;
    contentName: string;
}

const statusDuration = 2000;

function announce(message: string): void {
    // Visible tooltip feedback remains available, so limited ariaNotify support is acceptable here.
    if ("ariaNotify" in document && typeof document.ariaNotify === "function") document.ariaNotify(message);
}

export function CopyButton({text, contentName, className}: CopyButtonProps) {
    const [feedback, setFeedback] = useState<CopyFeedback>();
    const copyInProgress = useRef(false);

    useEffect(() => {
        if (feedback?.status !== "copied" && feedback?.status !== "failed") return;
        const timeout = setTimeout(() => {
            setFeedback((current) => (current === feedback ? undefined : current));
        }, statusDuration);
        return () => clearTimeout(timeout);
    }, [feedback]);

    const copy = async () => {
        if (copyInProgress.current) return;
        copyInProgress.current = true;
        setFeedback({status: "copying", text, contentName});
        try {
            await navigator.clipboard.writeText(text);
            setFeedback({status: "copied", text, contentName});
            announce(`${contentName} copied`);
        } catch {
            setFeedback({status: "failed", text, contentName});
            announce(`Could not copy ${contentName}`);
        } finally {
            copyInProgress.current = false;
        }
    };

    const status =
        feedback !== undefined && feedback.text === text && feedback.contentName === contentName ? feedback.status : "idle";
    const copied = status === "copied";
    const failed = status === "failed";
    const tooltip = status === "copying" ? "Copying…" : copied ? "✓ Copied" : status === "failed" ? "Copy failed" : "Copy";

    return (
        <IconButton
            className={cc(["qg-copy-button", className])}
            label={`Copy ${contentName}`}
            tooltip={tooltip}
            aria-busy={status === "copying"}
            onClick={() => void copy()}
        >
            {copied ? (
                <svg data-icon="check" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m3 8.25 3.25 3.25L13 4.75" />
                </svg>
            ) : failed ? (
                <svg data-icon="error" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m4 4 8 8m0-8-8 8" />
                </svg>
            ) : (
                <svg data-icon="copy" viewBox="0 0 16 16" aria-hidden="true">
                    <rect x="5.5" y="5.5" width="7" height="7" rx="1" />
                    <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
                </svg>
            )}
        </IconButton>
    );
}

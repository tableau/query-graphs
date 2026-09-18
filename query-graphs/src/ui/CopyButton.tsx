import {useEffect, useRef, useState} from "react";
import cc from "classcat";
import "./CopyButton.css";

export interface CopyButtonProps {
    text: string;
    contentName: string;
    className?: string;
}

type CopyStatus = "idle" | "copying" | "copied" | "failed";

interface CopyFeedback {
    status: CopyStatus;
    text: string;
    contentName: string;
}

const statusDuration = 2000;

export function CopyButton({text, contentName, className}: CopyButtonProps) {
    const [feedback, setFeedback] = useState<CopyFeedback>({status: "idle", text, contentName});
    const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const copyAttempt = useRef(0);
    const mounted = useRef(true);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            clearTimeout(resetTimer.current);
        };
    }, []);

    const showTemporaryStatus = (newStatus: "copied" | "failed", attempt: number) => {
        setFeedback({status: newStatus, text, contentName});
        clearTimeout(resetTimer.current);
        resetTimer.current = setTimeout(() => {
            if (mounted.current && copyAttempt.current === attempt) {
                setFeedback({status: "idle", text, contentName});
            }
        }, statusDuration);
    };

    const copy = async () => {
        const attempt = ++copyAttempt.current;
        clearTimeout(resetTimer.current);
        resetTimer.current = undefined;
        setFeedback({status: "copying", text, contentName});
        try {
            await navigator.clipboard.writeText(text);
            if (mounted.current && copyAttempt.current === attempt) showTemporaryStatus("copied", attempt);
        } catch {
            if (mounted.current && copyAttempt.current === attempt) showTemporaryStatus("failed", attempt);
        }
    };

    const status = feedback.text === text && feedback.contentName === contentName ? feedback.status : "idle";
    const label =
        status === "copying" ? "Copying…" : status === "copied" ? "✓ Copied" : status === "failed" ? "Copy failed" : "Copy";
    const announcement = status === "copied" ? `${contentName} copied` : status === "failed" ? `Could not copy ${contentName}` : "";

    return (
        <>
            <button
                type="button"
                className={cc(["qg-copy-button", className])}
                aria-label={`Copy ${contentName}`}
                aria-busy={status === "copying"}
                disabled={status === "copying"}
                onClick={() => void copy()}
            >
                {label}
            </button>
            <span className="qg-visually-hidden" role="status" aria-live="polite">
                {announcement}
            </span>
        </>
    );
}

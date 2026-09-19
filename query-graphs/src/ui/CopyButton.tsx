import {useEffect, useRef, useState} from "react";
import cc from "classcat";
import "./CopyButton.css";

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

export function CopyButton({text, contentName, className}: CopyButtonProps) {
    const [feedback, setFeedback] = useState<CopyFeedback>();
    const copyAttempt = useRef(0);

    useEffect(() => {
        if (feedback?.status !== "copied" && feedback?.status !== "failed") return;
        const timeout = setTimeout(() => {
            setFeedback((current) => (current === feedback ? undefined : current));
        }, statusDuration);
        return () => clearTimeout(timeout);
    }, [feedback]);

    const copy = async () => {
        const attempt = ++copyAttempt.current;
        setFeedback({status: "copying", text, contentName});
        try {
            await navigator.clipboard.writeText(text);
            if (copyAttempt.current === attempt) setFeedback({status: "copied", text, contentName});
        } catch {
            if (copyAttempt.current === attempt) setFeedback({status: "failed", text, contentName});
        }
    };

    const status =
        feedback !== undefined && feedback.text === text && feedback.contentName === contentName ? feedback.status : "idle";
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

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

function announce(message: string): void {
    try {
        if ("ariaNotify" in document && typeof document.ariaNotify === "function") {
            document.ariaNotify(message);
        }
    } catch {
        // Accessibility notifications must not change the outcome of the copy operation.
    }
}

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
            if (copyAttempt.current === attempt) {
                setFeedback({status: "copied", text, contentName});
                announce(`${contentName} copied`);
            }
        } catch {
            if (copyAttempt.current === attempt) {
                setFeedback({status: "failed", text, contentName});
                announce(`Could not copy ${contentName}`);
            }
        }
    };

    const status =
        feedback !== undefined && feedback.text === text && feedback.contentName === contentName ? feedback.status : "idle";
    const label =
        status === "copying" ? "Copying…" : status === "copied" ? "✓ Copied" : status === "failed" ? "Copy failed" : "Copy";

    return (
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
    );
}

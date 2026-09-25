import {type ButtonHTMLAttributes, type ReactNode} from "react";
import cc from "classcat";
import "./IconButton.css";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> {
    /** Accessible name announced for the button. */
    label: string;
    /** Short visual description shown on hover or keyboard focus. */
    tooltip?: string;
    children: ReactNode;
}

export function IconButton({label, tooltip = label, className, children, type = "button", ...props}: IconButtonProps) {
    return (
        <span className="qg-icon-button-wrapper">
            <button {...props} type={type} className={cc(["qg-icon-button", className])} aria-label={label}>
                {children}
            </button>
            <span className="qg-icon-button-tooltip" role="tooltip">
                <span>{tooltip}</span>
            </span>
        </span>
    );
}

import {ControlButton} from "@xyflow/react";
import {usePrefersReducedMotion} from "./animation-timing";
import {animationSpeedOptions, useSettings} from "./settings";
import type {AnimationSpeed} from "./settings";
import "./SettingsPanel.css";

interface SettingsTargetProps {
    popoverId: string;
}

export function SettingsButton({popoverId}: SettingsTargetProps) {
    return (
        <ControlButton
            className="qg-settings-button"
            popoverTarget={popoverId}
            title="Settings"
            aria-label="Settings"
            aria-haspopup="dialog"
        >
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path fillRule="evenodd" d="M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 3.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z" />
                {[0, 60, 120, 180, 240, 300].map((angle) => (
                    <rect key={angle} x="10" y="2" width="4" height="5" rx="0.5" transform={`rotate(${angle} 12 12)`} />
                ))}
            </svg>
        </ControlButton>
    );
}

export function SettingsPanel({popoverId}: SettingsTargetProps) {
    const animationSpeed = useSettings((settings) => settings.values.animationSpeed);
    const setSettings = useSettings((settings) => settings.setSettings);
    const resetSettings = useSettings((settings) => settings.resetSettings);
    const reducedMotion = usePrefersReducedMotion();
    const titleId = `${popoverId}-title`;
    const reducedMotionDescriptionId = `${popoverId}-reduced-motion`;

    return (
        <div id={popoverId} className="qg-settings-popover nowheel nopan" popover="auto" role="dialog" aria-labelledby={titleId}>
            <header className="qg-settings-header">
                <h2 id={titleId}>Settings</h2>
                <button
                    type="button"
                    className="qg-settings-close"
                    popoverTarget={popoverId}
                    popoverTargetAction="hide"
                    aria-label="Close settings"
                >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m6 6 12 12M18 6 6 18" />
                    </svg>
                </button>
            </header>
            <div className="qg-settings-body">
                <label className="qg-settings-row">
                    <span>Graph animation speed</span>
                    <select
                        value={animationSpeed}
                        aria-describedby={reducedMotion ? reducedMotionDescriptionId : undefined}
                        onChange={(event) => setSettings({animationSpeed: event.target.value as AnimationSpeed})}
                    >
                        {animationSpeedOptions.map(({value, label}) => (
                            <option key={value} value={value}>
                                {label}
                            </option>
                        ))}
                    </select>
                </label>
                {reducedMotion ? (
                    <p id={reducedMotionDescriptionId} className="qg-settings-note">
                        Animations are disabled by your system’s reduced-motion setting.
                    </p>
                ) : null}
                <footer className="qg-settings-footer">
                    <button type="button" onClick={resetSettings}>
                        Reset to defaults
                    </button>
                </footer>
            </div>
        </div>
    );
}

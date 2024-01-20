import React, {useCallback, useEffect, useMemo, useState} from "react";

import "./FileOpener.css";
import {assert} from "./assert";

export interface FileOpenerData {
    content: string;
    fileName?: string;
}

function readTextFromFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            resolve(reader.result as string);
        };
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

async function getTextFromPasteEvent(e: React.ClipboardEvent): Promise<FileOpenerData> {
    if (e.clipboardData.types.indexOf("Files") !== -1) {
        if (e.clipboardData.items.length > 1) {
            throw new Error("Cannot open multiple files");
        }
        const item = e.clipboardData.items[0];
        assert(item.kind == "file");
        const f = item.getAsFile();
        if (f === null) {
            throw new Error("Unable to access pasted file");
        }
        return {content: await readTextFromFile(f), fileName: f.name};
    } else {
        const items = [] as DataTransferItem[];
        Array.prototype.forEach.call(e.clipboardData.items, (item) => {
            items.push(item);
        });
        let foundItem: DataTransferItem | undefined;
        for (const item of items) {
            if (item.type.match("^text/plain")) {
                foundItem = item;
                break;
            }
        }
        if (foundItem !== undefined) {
            const text = (await new Promise((resolve) => foundItem!.getAsString(resolve))) as string;
            return {content: text};
        } else {
            const typesString = items.map((e) => e.type).join(", ");
            throw new Error(`None of the following types are supported: ${typesString}`);
        }
    }
}

interface RawLoadState {
    state: "pristine" | "loading" | "error";
    detail?: string;
}

interface LoadStateController {
    loadState: RawLoadState;
    clearLoadState: () => void;
    setProgress: (msg: string) => void;
    setError: (msg: string) => void;
    tryAndDisplayErrors: (doIt: () => Promise<void>) => Promise<void>;
}

export function useLoadStateController(): LoadStateController {
    const [loadState, setLoadState] = useState<RawLoadState>({state: "pristine"});
    const clearLoadState = useCallback(() => setLoadState({state: "pristine"}), [setLoadState]);
    const setProgress = useCallback((msg: string) => setLoadState({state: "loading", detail: msg}), [setLoadState]);
    const setError = useCallback((msg: string) => setLoadState({state: "error", detail: msg}), [setLoadState]);
    const tryAndDisplayErrors = useCallback(
        async (doIt: () => Promise<void>) => {
            try {
                await doIt();
            } catch (e) {
                let msg;
                if (e instanceof Error) {
                    msg = e.message;
                } else {
                    console.log(e);
                    msg = "Unknown error";
                }
                setError(msg);
            }
        },
        [setError],
    );
    return useMemo(() => {
        return {
            loadState,
            clearLoadState,
            setProgress,
            setError,
            tryAndDisplayErrors,
        };
    }, [loadState, clearLoadState, setProgress, setError, tryAndDisplayErrors]);
}

interface FileOpenerProps {
    /// Callback called with the selected data.
    /// Might throw an `Exception` if it can't open the received file.
    setData: (data: FileOpenerData) => Promise<void>;
    /// A validation function; returns an error string or "undefined" if the value is acceptable
    validate: (content: string) => string | undefined;
    /// Controller for displaying progress/completion
    loadStateController: LoadStateController;
}

export function FileOpener({setData, validate, loadStateController}: FileOpenerProps) {
    const {loadState, clearLoadState, tryAndDisplayErrors, setError} = loadStateController;
    const [planString, setPlanString] = useState<string>("");

    useEffect(() => {
        console.log("validate", planString);
        if (planString === "") {
            clearLoadState();
        } else {
            const error = validate(planString);
            console.log(error);
            if (error) {
                setError(error);
            } else {
                clearLoadState();
            }
        }
    }, [planString, validate, clearLoadState, setError]);

    const submitDisabled = planString.trim() === "" || loadState.state != "pristine";

    const onChange = useCallback(
        (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            setPlanString(e.target.value);
        },
        [setPlanString],
    );

    const onPaste = useCallback(
        async (e: React.ClipboardEvent) => {
            // If pasting into an empty input area, try to auto-submit on paste events
            if (planString === "") {
                await tryAndDisplayErrors(async () => {
                    await setData(await getTextFromPasteEvent(e));
                    clearLoadState();
                });
            }
        },
        [planString, setData, clearLoadState, tryAndDisplayErrors],
    );

    const submit = useCallback(async () => {
        if (planString.trim() === "") return;
        await tryAndDisplayErrors(async () => {
            await setData({content: planString});
            clearLoadState();
        });
    }, [planString, setData, tryAndDisplayErrors, clearLoadState]);

    const onKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key == "Enter" && (e.ctrlKey || e.metaKey)) {
                submit();
            }
        },
        [submit],
    );

    if (loadState.state == "loading") {
        return (
            <div className="file-selection-page">
                <div className="qg-spinner" />
                {loadState.detail}
            </div>
        );
    } else {
        let renderedError;
        if (loadState.state == "error") {
            renderedError = <div className="load-error">{loadState.detail}</div>;
        }
        return (
            <div className="file-selection-page">
                <div className="caption">
                    <img className="logo" src="query-graphs-logo.svg" />
                    Query Graphs
                </div>
                <div className="subcaption">Which query plan do you want to visualize?</div>
                <div className="file-selection-page-content">
                    <div className="hinted-textarea">
                        <textarea
                            placeholder="Paste your query plan here..."
                            autoFocus={true}
                            rows={5}
                            value={planString}
                            onChange={onChange}
                            onPaste={onPaste}
                            onKeyDown={onKeyDown}
                        ></textarea>
                        <div className="textarea-hint">Paste your query plan, either the textual contents or a file</div>
                    </div>
                    <button onClick={submit} disabled={submitDisabled}>
                        Parse and Visualize Plan
                    </button>
                    {renderedError}
                    <div className="github-link">
                        Open-sourced on <a href="https://github.com/tableau/query-graphs">Github</a>
                    </div>
                </div>
            </div>
        );
    }
}

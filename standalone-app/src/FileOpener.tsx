import React, {useCallback, useEffect, useMemo, useState} from "react";

import "./FileOpener.css";
import {assert} from "./assert";
import classcat from "classcat";

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

interface FileDropState {
    dragging: boolean;
    onDragOver: (e: React.DragEvent<HTMLElement>) => void;
    onDragLeave: (e: React.SyntheticEvent) => void;
}

function useFileDrop(): FileDropState {
    const [dragging, setDragOver] = useState(false);

    const onDragOver = (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault();
        setDragOver(e.dataTransfer.types.length == 1 && e.dataTransfer.types[0] == "Files");
    };

    const onDragLeave = () => setDragOver(false);

    return {
        dragging,
        onDragOver,
        onDragLeave,
    };
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
    const {dragging, onDragOver, onDragLeave} = useFileDrop();
    const [planString, setPlanString] = useState<string>("");

    // Re-validate the current string whenever it's updated
    useEffect(() => {
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

    const submit = useCallback(async () => {
        if (planString.trim() === "") return;
        await tryAndDisplayErrors(async () => {
            await setData({content: planString});
            clearLoadState();
        });
    }, [planString, setData, tryAndDisplayErrors, clearLoadState]);

    // If pasting into an empty input area, try to auto-submit on paste events
    const onPaste = useCallback(
        async (e: React.ClipboardEvent) => {
            if (planString === "") {
                await tryAndDisplayErrors(async () => {
                    await setData(await getTextFromPasteEvent(e));
                    clearLoadState();
                });
            }
        },
        [planString, setData, clearLoadState, tryAndDisplayErrors],
    );

    // Auto-submit on Ctrl/Cmd-Enter
    const onKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key == "Enter" && (e.ctrlKey || e.metaKey)) {
                submit();
            }
        },
        [submit],
    );

    // Allow dropping text
    const onDrop = useCallback(
        async (e: React.DragEvent<HTMLElement>) => {
            if (e.dataTransfer.types.length != 1 || e.dataTransfer.types[0] != "Files") {
                return;
            }
            e.preventDefault();
            onDragLeave(e);

            const file = e.dataTransfer.items[0].getAsFile();
            if (!file) {
                alert("No File");
                return;
            }

            await tryAndDisplayErrors(async () => {
                const content = await readTextFromFile(file);
                setPlanString(content);
                await setData({content, fileName: file.name});
                clearLoadState();
            });
        },
        [clearLoadState, onDragLeave, setData, tryAndDisplayErrors],
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
        let dragOverlay;
        if (dragging) {
            dragOverlay = <div className="dragging-operlay">Drop your plan here...</div>;
        }
        return (
            <div className={classcat("file-selection-page")} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
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
                        <div className="textarea-hint">Paste your query plan. To open a file, use drag & drop.</div>
                    </div>
                    <button onClick={submit} disabled={submitDisabled}>
                        Visualize Plan
                    </button>
                    {renderedError}
                    <div className="github-link">
                        Open-sourced on <a href="https://github.com/tableau/query-graphs">Github</a>
                    </div>
                </div>
                {dragOverlay}
            </div>
        );
    }
}

import {closeSearchPanel, findNext, findPrevious, getSearchQuery, SearchQuery, search, setSearchQuery} from "@codemirror/search";
import type {EditorState, Extension} from "@codemirror/state";
import {EditorView, type Panel, runScopeHandlers, type ViewUpdate} from "@codemirror/view";

const svgNamespace = "http://www.w3.org/2000/svg";

function createIcon(pathData: string): SVGSVGElement {
    const icon = document.createElementNS(svgNamespace, "svg");
    icon.setAttribute("viewBox", "0 0 16 16");
    icon.setAttribute("aria-hidden", "true");
    icon.classList.add("compact-search-icon");
    const path = document.createElementNS(svgNamespace, "path");
    path.setAttribute("d", pathData);
    icon.append(path);
    return icon;
}

function createButton(name: string, label: string, pathData: string, action: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.name = name;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.append(createIcon(pathData));
    button.addEventListener("click", action);
    return button;
}

function createToggle(name: string, label: string, text: string): [HTMLLabelElement, HTMLInputElement] {
    const toggle = document.createElement("label");
    toggle.className = "compact-search-toggle";
    toggle.title = label;

    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = name;
    input.setAttribute("aria-label", label);
    const visibleLabel = document.createElement("span");
    visibleLabel.textContent = text;
    toggle.append(input, visibleLabel);
    return [toggle, input];
}

class CompactSearchPanel implements Panel {
    readonly dom: HTMLElement;
    // Panel.top is CodeMirror's placement hook; it is unrelated to CSS positioning.
    readonly top = true;
    readonly #searchField: HTMLInputElement;
    readonly #invalidStatus: HTMLSpanElement;
    readonly #caseCheckbox: HTMLInputElement;
    readonly #regexpCheckbox: HTMLInputElement;
    readonly #wordCheckbox: HTMLInputElement;
    readonly #previousButton: HTMLButtonElement;
    readonly #nextButton: HTMLButtonElement;
    #query: SearchQuery;

    constructor(readonly view: EditorView) {
        // The search extension owns the canonical query in EditorState. Keep a
        // local copy only to render the controls and detect external updates.
        this.#query = getSearchQuery(view.state);
        this.#searchField = document.createElement("input");
        this.#searchField.className = "cm-textfield";
        this.#searchField.name = "search";
        this.#searchField.placeholder = "Find";
        this.#searchField.setAttribute("aria-label", "Find");
        // CodeMirror locates this field when openSearchPanel is invoked for an
        // already-open panel and when search commands restore its selection.
        this.#searchField.setAttribute("main-field", "true");
        this.#searchField.addEventListener("input", () => this.commit());
        this.#invalidStatus = document.createElement("span");
        this.#invalidStatus.className = "compact-search-status";
        this.#invalidStatus.setAttribute("role", "status");
        this.#invalidStatus.setAttribute("aria-atomic", "true");

        const [caseToggle, caseCheckbox] = createToggle("case", "Match case", "Aa");
        const [regexpToggle, regexpCheckbox] = createToggle("regexp", "Use regular expression", ".*");
        const [wordToggle, wordCheckbox] = createToggle("word", "Match whole word", "W");
        wordToggle.classList.add("compact-search-toggle-word");
        this.#caseCheckbox = caseCheckbox;
        this.#regexpCheckbox = regexpCheckbox;
        this.#wordCheckbox = wordCheckbox;
        for (const checkbox of [caseCheckbox, regexpCheckbox, wordCheckbox])
            checkbox.addEventListener("change", () => this.commit());
        this.syncQuery();

        this.#previousButton = createButton("prev", "Previous match (Shift+Enter)", "m3 10.5 5-5 5 5", () => findPrevious(view));
        this.#nextButton = createButton("next", "Next match (Enter)", "m3 5.5 5 5 5-5", () => findNext(view));
        this.syncActionButtons(view.state);

        this.dom = document.createElement("div");
        this.dom.className = "cm-search";
        this.dom.append(
            this.#searchField,
            this.#invalidStatus,
            this.#previousButton,
            this.#nextButton,
            caseToggle,
            regexpToggle,
            wordToggle,
            createButton("close", "Close search", "m4 4 8 8m0-8-8 8", () => closeSearchPanel(view)),
        );
        this.dom.addEventListener("keydown", (event) => this.keydown(event));
    }

    mount() {
        // On first open, CodeMirror mounts a custom panel but does not focus its
        // main-field. select() both focuses the field and selects its contents.
        this.#searchField.select();
    }

    update(update: ViewUpdate) {
        // Query changes may originate outside this panel through
        // setSearchQuery, so reflect the EditorState value back into the DOM.
        const query = getSearchQuery(update.state);
        const queryChanged = !query.eq(this.#query);
        if (queryChanged) {
            this.#query = query;
            this.syncQuery();
        }
        if (queryChanged || update.docChanged) this.syncActionButtons(update.state);
    }

    private commit() {
        const query = new SearchQuery({
            search: this.#searchField.value,
            caseSensitive: this.#caseCheckbox.checked,
            regexp: this.#regexpCheckbox.checked,
            wholeWord: this.#wordCheckbox.checked,
        });
        if (query.eq(this.#query)) return;
        // Updating CodeMirror state lets its search extension perform matching,
        // highlighting, navigation, and any necessary panel updates.
        this.view.dispatch({effects: setSearchQuery.of(query)});
    }

    private syncQuery() {
        this.#searchField.value = this.#query.search;
        this.#caseCheckbox.checked = this.#query.caseSensitive;
        this.#regexpCheckbox.checked = this.#query.regexp;
        this.#wordCheckbox.checked = this.#query.wholeWord;

        // An empty query is also invalid to CodeMirror, but only malformed
        // regular expressions represent an error that should be reported.
        const invalidRegexp = this.#query.regexp && this.#query.search.length > 0 && !this.#query.valid;
        if (invalidRegexp) {
            this.#searchField.setAttribute("aria-invalid", "true");
            this.#searchField.title = "Invalid regular expression";
        } else {
            this.#searchField.removeAttribute("aria-invalid");
            this.#searchField.removeAttribute("title");
        }
        this.#invalidStatus.textContent = invalidRegexp ? "Invalid regular expression" : "";
    }

    private syncActionButtons(state: EditorState) {
        const disabled = !this.#query.valid || this.#query.getCursor(state).next().done === true;
        for (const button of [this.#previousButton, this.#nextButton]) button.disabled = disabled;
    }

    private keydown(event: KeyboardEvent) {
        // Preserve CodeMirror's search-panel-scoped bindings, notably Escape
        // and commands installed by consumers through the search keymap.
        if (runScopeHandlers(this.view, event, "search-panel")) {
            event.preventDefault();
        } else if (event.key === "Enter" && event.target === this.#searchField) {
            event.preventDefault();
            (event.shiftKey ? findPrevious : findNext)(this.view);
        }
    }
}

const compactSearchTheme = EditorView.theme({
    ".cm-panel.cm-search": {
        display: "flex",
        alignItems: "center",
        gap: "2px",
        padding: "4px",
        overflowX: "auto",
    },
    ".cm-panel.cm-search .cm-textfield[name=search]": {
        flex: "1 1 8rem",
        minWidth: "6rem",
        height: "1.75rem",
        boxSizing: "border-box",
        margin: "0 2px 0 0",
    },
    ".cm-panel.cm-search .cm-textfield[name=search][aria-invalid=true]": {
        borderColor: "hsl(0, 70%, 50%)",
        boxShadow: "0 0 0 1px hsl(0, 70%, 50%)",
    },
    ".cm-panel.cm-search button": {
        display: "inline-flex",
        flex: "0 0 auto",
        alignItems: "center",
        justifyContent: "center",
        width: "1.75rem",
        height: "1.75rem",
        boxSizing: "border-box",
        margin: "0",
        padding: "0",
        border: "1px solid transparent",
        borderRadius: "3px",
        background: "transparent",
        color: "inherit",
        cursor: "pointer",
    },
    ".cm-panel.cm-search button:hover:not(:disabled)": {
        backgroundColor: "hsl(0, 0%, 90%)",
    },
    ".cm-panel.cm-search button:focus-visible": {
        outline: "2px solid hsl(210, 90%, 65%)",
        outlineOffset: "-2px",
    },
    ".cm-panel.cm-search button:disabled": {
        cursor: "default",
        opacity: "0.35",
    },
    ".cm-panel.cm-search button[name=close]": {
        position: "static",
    },
    ".cm-panel.cm-search .compact-search-icon": {
        width: "1rem",
        height: "1rem",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "1.5",
        strokeLinecap: "round",
        strokeLinejoin: "round",
    },
    ".cm-panel.cm-search .compact-search-toggle": {
        position: "relative",
        display: "inline-flex",
        flex: "0 0 auto",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "1.75rem",
        height: "1.75rem",
        boxSizing: "border-box",
        margin: "0",
        padding: "0 4px",
        border: "1px solid transparent",
        borderRadius: "3px",
        cursor: "pointer",
        userSelect: "none",
    },
    ".cm-panel.cm-search .compact-search-toggle:hover": {
        backgroundColor: "hsl(0, 0%, 90%)",
    },
    ".cm-panel.cm-search .compact-search-toggle:has(input:focus-visible)": {
        outline: "2px solid hsl(210, 90%, 65%)",
        outlineOffset: "-2px",
    },
    ".cm-panel.cm-search .compact-search-toggle:has(input:checked)": {
        borderColor: "hsl(210, 70%, 65%)",
        backgroundColor: "hsl(210, 90%, 92%)",
    },
    ".cm-panel.cm-search .compact-search-toggle span": {
        fontSize: "0.75rem",
        lineHeight: "1",
    },
    ".cm-panel.cm-search .compact-search-toggle-word span": {
        textDecoration: "underline",
    },
    ".cm-panel.cm-search input[type=checkbox]": {
        position: "absolute",
        width: "1px",
        height: "1px",
        margin: "0",
        opacity: "0",
    },
    ".cm-panel.cm-search .compact-search-status": {
        position: "absolute",
        width: "1px",
        height: "1px",
        padding: "0",
        margin: "-1px",
        overflow: "hidden",
        clip: "rect(0, 0, 0, 0)",
        whiteSpace: "nowrap",
        border: "0",
    },
});

export const compactSearch: Extension = [
    // createPanel is CodeMirror's supported hook for replacing only the search
    // UI while retaining its search state, commands, and match highlighting.
    search({top: true, createPanel: (view) => new CompactSearchPanel(view)}),
    compactSearchTheme,
];

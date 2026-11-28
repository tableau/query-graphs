import "./InvalidUrl.css";

interface InvalidUrlProps {
    errors: readonly string[];
    canIgnoreDuplicates: boolean;
    onIgnoreDuplicates: () => void;
    onStartOver: () => void;
}

export function InvalidUrl({errors, canIgnoreDuplicates, onIgnoreDuplicates, onStartOver}: InvalidUrlProps) {
    return (
        <section className="invalid-url-page invalid-url-content" aria-labelledby="invalid-url-title">
            <h1 id="invalid-url-title">Invalid URL</h1>
            <p>This link contains invalid query plan settings:</p>
            <ul className="invalid-url-errors">
                {errors.map((error, index) => (
                    <li key={`${index}-${error}`}>{error}</li>
                ))}
            </ul>
            <p className="invalid-url-help">
                {canIgnoreDuplicates
                    ? "Ignoring duplicate keys keeps the first value in the link."
                    : "There are no duplicate keys to ignore. Start over to open a new plan."}
            </p>
            <div className="invalid-url-actions">
                <button type="button" disabled={!canIgnoreDuplicates} onClick={onIgnoreDuplicates}>
                    Ignore duplicate keys
                </button>
                <button type="button" onClick={onStartOver}>
                    Back to main page
                </button>
            </div>
        </section>
    );
}

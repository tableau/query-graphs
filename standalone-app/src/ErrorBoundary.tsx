import {Component, ReactNode} from "react";

interface ErrorBoundaryState {
    error?: unknown;
}

function extractErrorText(e: unknown): string {
    if (e instanceof Error) {
        if (e.stack) return e.stack.toString();
        return `${e.name}: ${e.message}`;
    } else if (e instanceof Object) {
        return e.toString();
    }
    return "unknown error";
}

export class ErrorBoundary extends Component<{children?: ReactNode}, ErrorBoundaryState> {
    constructor(props: any) {
        super(props);
        this.state = {};
    }

    static getDerivedStateFromError(error: unknown) {
        // Update state so the next render will show the fallback UI.
        return {error};
    }

    render() {
        if (this.state.error !== undefined) {
            const errorText = extractErrorText(this.state.error);
            // You can render any custom fallback UI
            return (
                <>
                    <h1>Something went wrong</h1>
                    <p>
                        Please file a bug on <a href="https://github.com/tableau/query-graphs/issues">Github</a> and include the
                        following information
                    </p>
                    <pre>{errorText}</pre>
                </>
            );
        }

        return this.props.children;
    }
}

import {createRoot} from "react-dom/client";

import "bootstrap/dist/css/bootstrap-reboot.min.css";
import "./index.css";
import "@tableau/query-graphs/lib/ui/Theme.css";
import {ErrorBoundary} from "./ErrorBoundary";
import {QueryGraphsApp} from "./QueryGraphsApp";
import {ThemeContext, useResolvedThemeSetting} from "./theme";

function TopLevelApp() {
    const theme = useResolvedThemeSetting();
    return (
        <div className="main-app-container qg-theme" data-theme={theme}>
            <ThemeContext.Provider value={theme}>
                <ErrorBoundary>
                    <QueryGraphsApp />
                </ErrorBoundary>
            </ThemeContext.Provider>
        </div>
    );
}

window.addEventListener("DOMContentLoaded", (_event) => {
    const domContainer = document.body.appendChild(document.createElement("DIV"));
    domContainer.classList.add("app-root");
    const root = createRoot(domContainer);
    root.render(<TopLevelApp />);
});

// Check that service workers are supported
if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
    // Use the window load event to keep the page load performant
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("service-worker.js");
    });
}

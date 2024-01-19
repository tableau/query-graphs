import {createRoot} from "react-dom/client";

import "bootstrap/dist/css/bootstrap-reboot.min.css";
import "./index.css";
import {ErrorBoundary} from "./ErrorBoundary";
import {QueryGraphsApp} from "./QueryGraphsApp";

function TopLevelApp() {
    return (
        <ErrorBoundary>
            <QueryGraphsApp />
        </ErrorBoundary>
    );
}

window.addEventListener("DOMContentLoaded", (_event) => {
    const domContainer = document.body.appendChild(document.createElement("DIV"));
    domContainer.classList.add("main-app-container");
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

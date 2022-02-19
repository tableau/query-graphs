import React, {useState} from "react";
import ReactDOM from "react-dom";
import {FileOpener, FileOpenerData} from "./FileOpener";
import {QueryGraphViz} from "./QueryGraphViz";
import {TreeDescription} from "@tableau/query-graphs/lib/tree-description";
import {loadPlan} from "./tree-loader";

import "./index.css";
import "bootstrap/dist/css/bootstrap.min.css";

function getRandomSlug() {
    const slugDigits = 4;
    const randomId =  Math.floor(Math.random() * Math.pow(256, slugDigits));
    return randomId.toString(16).padStart(slugDigits+1, '0');
}

function App() {
    const [tree, setTree] = useState<TreeDescription | undefined>(undefined);
    const setPlan = async (data: FileOpenerData) => {
        const tree = loadPlan(data.content, data.fileName);
        const localStorageKey = "file-" + getRandomSlug();
        localStorage.setItem(localStorageKey, JSON.stringify(data));

        console.log(localStorageKey);
        setTree(tree);
    };

    if (!tree) {
        return <FileOpener setData={setPlan} />;
    } else {
        return <QueryGraphViz treeDescription={tree} />;
    }
}

window.addEventListener("DOMContentLoaded", _event => {
    const domContainer = document.querySelector("#main");
    ReactDOM.render(<App />, domContainer);
});

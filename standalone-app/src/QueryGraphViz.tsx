import React, {useEffect, useRef} from "react";
import {TreeDescription} from "@tableau/query-graphs/lib/tree-description";
import {drawQueryTree} from "@tableau/query-graphs/lib/tree-rendering";
import {assert} from "./assert";

import "@tableau/query-graphs/style/query-graphs.css";
import "./QueryGraphViz.css";

interface QueryGraphVizProps {
    treeDescription: TreeDescription;
}

export function QueryGraphViz({treeDescription}: QueryGraphVizProps) {
    const areaRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        assert(areaRef.current !== null);
        const widget = drawQueryTree(areaRef.current, treeDescription);
        let timer = 0;
        const resizeListener = () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => widget.resize(), 500);
        };
        window.addEventListener("resize", resizeListener);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener("resize", resizeListener);
        };
    }, [areaRef, treeDescription]);

    return <div className="tree-container" ref={areaRef}></div>;
}

// Load css (through the style-loader of webpack)
import "./app.css";

// Import node.js modules
import fetchText from "d3-fetch/src/text";
import * as Spinner from "spin";
import * as querystring from "querystring";

// Require local modules
import * as treeRendering from "@tableau/query-graphs/lib/tree-rendering";
import * as hyperLoader from "@tableau/query-graphs/lib/hyper";
import * as tableauLoader from "@tableau/query-graphs/lib/tableau";
import * as jsonLoader from "@tableau/query-graphs/lib/json";
import * as tqlLoader from "@tableau/query-graphs/lib/tql";
import * as xmlLoader from "@tableau/query-graphs/lib/xml";
const knownLoaders = {
    hyper: hyperLoader.loadHyperPlanFromText,
    tableau: tableauLoader.loadTableauPlan,
    json: jsonLoader.loadJsonFromText,
    tql: tqlLoader.loadTQLPlan,
    xml: xmlLoader.loadXml,
    raw: JSON.parse,
};

// Get query parameters from current url
const paramErrors = [] as any[];
let currentSearch = window.location.search;
currentSearch = currentSearch.substring(1);

// Parse using querystring from jquery
const queryObject = querystring.parse(currentSearch);

// Get the debug flag
let DEBUG = queryObject.debug ? queryObject.debug : false;
DEBUG = DEBUG !== false;

// Get file path
let graphFile = queryObject.file ?? "favorites/logicalquery.xml";

// Get inline graph string
let inlineString;
if (queryObject.inline) {
    inlineString = queryObject.inline;
    graphFile = "";
}

// Get file format
const fileFormat = queryObject.format;
if (fileFormat !== undefined && !knownLoaders.hasOwnProperty(fileFormat)) {
    paramErrors.push("File format '" + fileFormat + "' not supported.");
}

// Get orientation name
const graphOrientation = queryObject.orientation ? queryObject.orientation : "top-to-bottom";
switch (graphOrientation) {
    case "top-to-bottom":
    case "right-to-left":
    case "bottom-to-top":
    case "left-to-right":
        break;
    default:
        paramErrors.push("Graph orientation '" + graphOrientation + "' not supported.");
        break;
}

// Get node collapse mode 'n' - no/none, 'y' - yes/some, 's' - streamline all secondary nodes
const graphCollapse = queryObject.collapse ? queryObject.collapse : "s";
switch (graphCollapse) {
    case "n":
    case "y":
    case "s":
        break;
    default:
        paramErrors.push("Graph collapse '" + graphCollapse + "' not supported.");
        break;
}

// Get properties to be rendered in the toplevel info card
let toplevelProperties = {} as any;
if (queryObject.properties) {
    try {
        toplevelProperties = JSON.parse(queryObject.properties);
    } catch (err) {
        paramErrors.push("invalid `properties`: JSON parse failed with '" + err + "'.");
    }
}

// Add the file name to the displayed properties
if (!inlineString) {
    toplevelProperties.file = graphFile;
}

const delay = (function() {
    let timer = 0;
    return function(callback, ms) {
        clearTimeout(timer);
        timer = setTimeout(callback, ms);
    };
})();

//
// Register event listeners not already handled by the query-graphs core
//
function registerEventHandlers(widget) {
    document.body.addEventListener(
        "keydown",
        function(e) {
            // Emit event key codes for debugging
            if (DEBUG) {
                console.log("pressed key " + e.keyCode);
            }

            // On space, expand all currently visible collapsed nodes, that is all for now
            // Subsequent uses may expand additional visible nodes that are now visible
            // Refresh browser window to get back to baseline
            if (e.keyCode === 32) {
                widget.expandOneLevel();
            }
        },
        false,
    );
    window.addEventListener("resize", function() {
        delay(function() {
            widget.resize();
        }, 500);
    });
}

//
// Kick it off
//
const spinner = new Spinner().spin(document.body);
if (paramErrors.length) {
    spinner.stop();
    document.write("invalid parameters!<br>");
    document.write(
        paramErrors.reduce(function(a, b) {
            return a + "<br/>" + b;
        }),
    );
} else {
    const displayTree = function(graphString) {
        // Remove explicit newlines
        graphString = graphString.replace(/\\n/gm, " ");
        // Detect file type
        let loaders;
        if (fileFormat !== undefined) {
            loaders = [knownLoaders[fileFormat]];
        } else if (graphFile.endsWith(".json")) {
            loaders = [knownLoaders.hyper, knownLoaders.json];
        } else if (graphFile.endsWith(".xml")) {
            loaders = [knownLoaders.tableau, knownLoaders.xml];
        } else if (graphFile.endsWith(".twb")) {
            loaders = [knownLoaders.xml];
        } else if (graphFile.endsWith(".tql")) {
            loaders = [knownLoaders.tql];
        } else if (graphFile.endsWith(".log")) {
            loaders = [knownLoaders.tql];
        } else {
            loaders = [knownLoaders.tableau, knownLoaders.hyper, knownLoaders.xml, knownLoaders.json, knownLoaders.tql];
        }

        // Try to load the data with the available loaders
        const errors: string[] = [];
        let loadedTree: any = null;
        function tryLoad(loader) {
            const result: any = loader(graphString, graphCollapse);
            if ("error" in result) {
                errors.push(result.error);
                return false;
            }
            loadedTree = result;
            return true;
        }
        if (loaders.some(tryLoad)) {
            if (loadedTree.properties === undefined) {
                loadedTree.properties = {};
            }
            Object.getOwnPropertyNames(toplevelProperties).forEach(function(key) {
                loadedTree.properties[key] = toplevelProperties[key];
            });
            loadedTree.graphOrientation = graphOrientation;
            loadedTree.DEBUG = DEBUG;
            spinner.stop();
            const treeContainer = document.createElement("div");
            treeContainer.className = "tree-container";
            document.body.appendChild(treeContainer);
            const widget = treeRendering.drawQueryTree(treeContainer, loadedTree);
            registerEventHandlers(widget);
        } else {
            spinner.stop();
            document.write(
                errors.reduce(function(a, b) {
                    return a + "<br/>" + b;
                }),
            );
        }
    };
    if (inlineString) {
        displayTree(inlineString);
    } else {
        fetchText(graphFile).then(displayTree, function(err) {
            document.write("Request for '" + graphFile + "' failed with '" + err + "'.");
        });
    }
}

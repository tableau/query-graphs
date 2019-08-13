// Load css (through the style-loader of webpack)
import './app.css';

// Import node.js modules
import * as path from 'path';
import fetchText from 'd3-fetch/src/text';
import * as Spinner from 'spin';
import * as querystring from 'querystring';

// Require local modules
import * as treeRendering from '@tableau/query-graphs/lib/tree-rendering';
import * as hyperLoader from '@tableau/query-graphs/lib/hyper';
import * as tableauLoader from '@tableau/query-graphs/lib/tableau';
import * as jsonLoader from '@tableau/query-graphs/lib/json';
import * as tqlLoader from '@tableau/query-graphs/lib/tql';
import * as xmlLoader from '@tableau/query-graphs/lib/xml';
var knownLoaders = {
    hyper: hyperLoader.loadHyperPlanFromText,
    tableau: tableauLoader.loadTableauPlan,
    json: jsonLoader.loadJsonFromText,
    tql: tqlLoader.loadTQLPlan,
    xml: xmlLoader.loadXml,
    raw: JSON.parse
};

// Get query parameters from current url
var paramErrors = [];
var currentSearch = window.location.search;
currentSearch = currentSearch.substring(1);

// Parse using querystring from jquery
var queryObject = querystring.parse(currentSearch);

// Get the debug flag
var DEBUG = queryObject.debug ? queryObject.debug : false;
DEBUG = DEBUG !== false;

// Get file name
var graphFile = queryObject.file ? queryObject.file : "logicalquery.xml";

// Get file from upload directory?
var isUploadedFile = queryObject.upload ? queryObject.upload : "n";
isUploadedFile = (isUploadedFile === "y");

// Generate the query directory
var directory = isUploadedFile ? "../media/uploads/" : "../media/favorites/";

// Get absolute path file name and directory
var isAbsolutePath = queryObject.absolute ? queryObject.absolute : "n";
isAbsolutePath = (isAbsolutePath === "y");
if (isAbsolutePath) {
    directory = path.dirname(graphFile) + "/";
    graphFile = path.basename(graphFile);
}

// Get inline graph string
var inlineString;
if (queryObject.inline) {
    inlineString = queryObject.inline;
    graphFile = "";
}

// Get file format
var fileFormat = queryObject.format;
if (fileFormat !== undefined && !knownLoaders.hasOwnProperty(fileFormat)) {
    paramErrors.push("File format '" + fileFormat + "' not supported.");
}

// Get orientation name
var graphOrientation = queryObject.orientation ? queryObject.orientation : "top-to-bottom";
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
var graphCollapse = queryObject.collapse ? queryObject.collapse : "s";
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
var toplevelProperties = {};
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


var delay = (function() {
    var timer = 0;
    return function(callback, ms) {
        clearTimeout(timer);
        timer = setTimeout(callback, ms);
    };
})();

//
// Register event listeners not already handled by the query-graphs core
//
function registerEventHandlers(widget) {
    document.body.addEventListener("keydown", function(e) {
       // Emit event key codes for debugging
       if (DEBUG) {
           console.log("pressed key " + event.keyCode);
       }

       // On space, expand all currently visible collapsed nodes, that is all for now
       // Subsequent uses may expand additional visible nodes that are now visible
       // Refresh browser window to get back to baseline
       if (event.keyCode === 32) {
          widget.expandOneLevel()
       }
   }, false);
   window.addEventListener("resize", function() {
       delay(function() { widget.resize(); }, 500);
   });
}

//
// Kick it off
//
var spinner = new Spinner().spin(document.body);
if (paramErrors.length) {
    spinner.stop();
    document.write("invalid parameters!<br>");
    document.write(paramErrors.reduce(function(a, b) {
        return a + "<br/>" + b;
    }));
} else {
    var displayTree = function(graphString) {
        // Remove explicit newlines
        graphString = graphString.replace(/\\n/gm, " ");
        // Detect file type
        var loaders;
        if (fileFormat !== undefined) {
            loaders = [knownLoaders[fileFormat]];
        } else if (path.extname(graphFile) === '.json') {
            loaders = [knownLoaders.hyper, knownLoaders.json];
        } else if (path.extname(graphFile) === '.xml') {
            loaders = [knownLoaders.tableau, knownLoaders.xml];
        } else if (path.extname(graphFile) === '.twb') {
            loaders = [knownLoaders.xml];
        } else if (path.extname(graphFile) === '.tql') {
            loaders = [knownLoaders.tql];
        } else if (path.extname(graphFile) === '.log') {
            loaders = [knownLoaders.tql];
        } else {
            loaders = [knownLoaders.tableau, knownLoaders.hyper, knownLoaders.xml, knownLoaders.json, knownLoaders.tql];
        }

        // Try to load the data with the available loaders
        var errors = [];
        var loadedTree = null;
        function tryLoad(loader) {
            var result = loader(graphString, graphCollapse);
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
            var treeContainer = document.createElement('div');
            treeContainer.className = "tree-container";
            document.body.appendChild(treeContainer);
            var widget = treeRendering.drawQueryTree(treeContainer, loadedTree);
            registerEventHandlers(widget);
        } else {
            spinner.stop();
            document.write(errors.reduce(function(a, b) {
                return a + "<br/>" + b;
            }));
        }
    };
    if (inlineString) {
        displayTree(inlineString);
    } else {
        fetchText(directory + graphFile)
            .then(displayTree, function(err) {
                document.write("Request for '" + directory + graphFile + "' failed with '" + err + "'.");
            });
    }
}

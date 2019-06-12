// Require node.js modules
var path = require('path');

// Require local modules
var treeRendering = require('query-graphs/lib/tree-rendering');
var knownLoaders = {
    hyper: require('query-graphs/lib/hyper').loadHyperPlan,
    tableau: require('query-graphs/lib/tableau').loadTableauPlan,
    json: require('query-graphs/lib/json').loadJson,
    tql: require('query-graphs/lib/tql').loadTQLPlan,
    xml: require('query-graphs/lib/xml').loadXml,
    raw: JSON.parse
};

// Require node modules
var d3Fetch = require('query-graphs/node_modules/d3-fetch');
var Spinner = require('spin');

// Get query parameters from current url
var paramErrors = [];
var currentSearch = window.location.search;
currentSearch = currentSearch.substring(1);

// Parse using querystring from jquery
var querystring = require('querystring');
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
            treeRendering.drawQueryTree(treeContainer, loadedTree);
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
        d3Fetch.text(directory + graphFile)
            .then(displayTree, function(err) {
                document.write("Request for '" + directory + graphFile + "' failed with '" + err + "'.");
            });
    }
}

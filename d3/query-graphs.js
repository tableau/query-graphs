
// Require node.js modules
var path = require('path');

// Require local modules
var common = require('./common');
var colors = require('./colors');
var hyper = require('./hyper');

// Require node modules
var $ = require('jquery');
var xml2js = require('xml2js');
var d3 = require('d3');
var d3tip = require('d3-tip');
var Spinner = require('spin');

// Initialize tooltip
d3tip(d3);

// Get query parameters from current url
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

// Get orientation name
var graphOrientation = queryObject.orientation ? queryObject.orientation : "top-to-bottom";
switch (graphOrientation) {
    case "top-to-bottom":
    case "right-to-left":
    case "bottom-to-top":
    case "left-to-right":
        break;
    default:
        document.write("Graph orientation '" + graphOrientation + "' not supported.");
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
        document.write("Graph collapse '" + graphCollapse + "' not supported.");
        break;
}

var MAX_DISPLAY_LENGTH = 15;
var svgGroup;

// Resize event
var delay = (function() {
    var timer = 0;
    return function(callback, ms) {
        clearTimeout(timer);
        timer = setTimeout(callback, ms);
    };
})();

$(window).resize(function() {
    delay(function() {
        console.log("resize!");
        // Adjust the view box
        var svgElement = document.getElementsByTagName("svg")[0];
        svgElement.setAttribute("viewBox", "0 0 " +
            window.innerWidth + " " + window.innerHeight);
        // Adjust the height (necessary in Internet Explorer)
        svgElement.setAttribute("height", window.innerHeight);
    }, 500);
});

var target = document.getElementById('tree-container');
var spinner = new Spinner().spin(target);

//
// Get graph data
//
d3.text(directory + graphFile, function(err, graphString) {
    spinner.stop();

    if (err) {
        if (inlineString) {
            graphString = inlineString;
        } else {
            document.write("Request for '" + directory + graphFile + "' failed with '" + err + "'.");
            return;
        }
    }

    // Remove explicit newlines
    graphString = graphString.replace(/\\n/gm, " ");

    // Convert XML to JSON or parse as JSON per filename extension
    var treeData = "";
    var _treeData = "";
    var convertHyPer = false;
    var parser = new xml2js.Parser({
        explicitArray: false,
        // Don't merge attributes. XML attributes will be stored in node["$"]
        mergeAttrs: false
    });
    if (path.extname(graphFile) === '.json') {
        try {
            _treeData = JSON.parse(graphString);
            convertHyPer = true;
        } catch (err) {
            document.write("JSON parse failed with '" + err + "'.");
        }
    } else if (path.extname(graphFile) === '.xml') {
        parser.parseString(graphString, function(err, result) {
            _treeData = result;
            if (err) {
                document.write("XML parse failed with '" + err + "'.");
            }
        });
    } else {
        parser.parseString(graphString, function(errXml, result) {
            _treeData = result;
            if (errXml) {
                try {
                    _treeData = JSON.parse(graphString);
                    convertHyPer = true;
                } catch (err) {
                    document.write("XML parse failed with '" + errXml + "'.<br />");
                    document.write("JSON parse failed with '" + err + "'.");
                }
            }
        });
    }

    // Convert generic JSON to d3 tree format
    function convertJSON(node, tag) {
        var innerNode;
        if (typeof (node) === "object" && !Array.isArray(node)) {
            // "Object" nodes
            var children = [];
            var properties;
            var text;

            if (node === null) {
                return {
                    tag: tag,
                    text: node
                };
            }

            Object.keys(node).forEach(function(key, _index) {
                // $ indicates attributes in the XML, _ indicates the value of the text node
                if (key === "$") {
                    properties = node[key];
                    return;
                }
                if (key === "_") {
                    text = node[key];
                    return;
                }

                // All other object attributes indicate inner nodes
                innerNode = convertJSON(node[key], key);
                if (Array.isArray(innerNode)) {
                    children = children.concat(innerNode);
                } else {
                    children.push(innerNode);
                }
            });
            return {
                tag: tag,
                properties: properties,
                text: text,
                children: children
            };
        } else if (Array.isArray(node)) {
            // "Array" nodes
            var listOfObjects = [];
            node.forEach(function(value, _index) {
                innerNode = convertJSON(value, tag);
                listOfObjects.push(innerNode);
            });
            return listOfObjects;
        } else if (typeof (node) === "string") {
            // "String" nodes
            return {
                tag: tag,
                text: node
            };
        }
        console.warn("Convert to JSON case not implemented");
    }

    // Function to generate nodes display names based on their properties
    var generateDisplayNames = (function() {
        // properties.class are the expressions
        function handleLogicalExpression(node) {
            switch (node.properties.class) {
                case "identifier":
                    node.name = node.text;
                    node.class = "identifier";
                    break;
                case "funcall":
                    node.name = node.properties.function;
                    node.class = "function";
                    break;
                case "literal":
                    node.name = node.properties.datatype + ":" + node.text;
                    break;
                default:
                    node.name = node.properties.class;
                    break;
            }
        }

        // tags are the expressions
        function handleLogicalExpression2(node) {
            switch (node.tag) {
                case "identifierExp":
                    node.name = node.properties.identifier;
                    node.class = "identifier";
                    break;
                case "funcallExp":
                    node.name = node.properties.function;
                    node.class = "function";
                    break;
                case "literalExp":
                    node.name = node.properties.datatype + ":" + node.properties.value;
                    break;
                default:
                    node.name = node.tag.replace(/Exp$/, '');
                    break;
            }
        }

        function handleQueryExpression(node) {
            switch (node.properties.class) {
                case "identifier":
                    node.name = node.text;
                    node.class = "identifier";
                    break;
                case "funcall":
                    node.name = node.properties.function;
                    node.class = "function";
                    break;
                case "literal":
                    node.name = node.properties.datatype + ":" + node.text;
                    break;
                default:
                    node.name = node.properties.class;
                    break;
            }
        }

        function handleQueryFunction(node) {
            switch (node.properties.class) {
                case "table":
                    node.name = node.properties.table;
                    node.class = "relation";
                    break;
                default:
                    node.name = node.properties.class;
                    break;
            }
        }

        // properties.class are the operators
        function handleLogicalOperator(node) {
            switch (node.properties.class) {
                case "join":
                    node.name = node.properties.name;
                    node.class = "join";
                    break;
                case "relation":
                    node.name = node.properties.name;
                    node.class = "relation";
                    break;
                case "tuples":
                    if (node.properties.alias) {
                        node.name = node.properties.class + ":" + node.properties.alias;
                    } else {
                        node.name = node.properties.class;
                    }
                    break;
                case "createtemptable":
                    if (node.properties.table) {
                        node.name = node.properties.table;
                    } else {
                        node.name = node.properties.class;
                    }
                    break;
                default:
                    node.name = node.properties.class;
                    break;
            }
        }

        // tags are the operators
        function handleLogicalOperator2(node) {
            switch (node.tag) {
                case "joinOp":
                    node.name = node.tag.replace(/Op$/, '');
                    node.class = "join";
                    break;
                case "relationOp":
                    node.name = node.properties.name;
                    node.class = "relation";
                    break;
                case "tuplesOp":
                    if (node.properties.alias) {
                        node.name = node.tag.replace(/Op$/, '') + ":" + node.properties.alias;
                    } else {
                        node.name = node.tag.replace(/Op$/, '');
                    }
                    break;
                case "createtemptableOp":
                    if (node.properties.table) {
                        node.name = node.properties.table;
                    } else {
                        node.name = node.tag.replace(/Op$/, '');
                    }
                    break;
                default:
                    node.name = node.tag.replace(/Op$/, '');
                    break;
            }
        }

        function generateDisplayNames(node) {
            // In-order traversal. Leaf node don't have children
            if (node.children) {
                for (var i = 0; i < node.children.length; i++) {
                    generateDisplayNames(node.children[i]);
                }
            }
            switch (node.tag) {
                case "logical-expression":
                    handleLogicalExpression(node);
                    break;
                case "query-expression":
                    handleQueryExpression(node);
                    break;
                case "query-function":
                    handleQueryFunction(node);
                    break;
                case "fed-op":
                case "logical-operator":
                    handleLogicalOperator(node);
                    break;
                case "calculation":
                    node.name = node.properties.formula;
                    break;
                case "condition":
                    if (node.properties) {
                        node.name = node.properties.op;
                    } else {
                        node.name = node.tag;
                    }
                    break;
                case "field":
                    if (node.text) {
                        node.name = node.text;
                        break;
                    } else if (node.properties) {
                        node.name = node.properties.name;
                    } else {
                        node.name = "field{}";
                    }
                    break;
                case "binding":
                case "relation":
                case "column":
                case "runquery-column":
                    node.name = node.properties.name;
                    break;
                case "tuple":
                case "header":
                case "iu":
                case "name":
                case "mode":
                case "expression":
                case "value":
                case "values":
                case "output":
                case "distinctValues":
                case "unnormalizedNames":
                    if (node.text) {
                        node.name = node.text;
                    } else {
                        node.name = node.tag;
                    }
                    break;
                case "attribute":
                case "operation":
                case "source":
                case "table":
                case "tableOid":
                case "tid":
                case "tupleFlags":
                case "type":
                case "unique":
                    if (node.text) {
                        node.name = node.tag + ":" + node.text;
                    } else {
                        if (node.properties && node.properties.name) {
                            node.name = node.tag + ":" + node.properties.name;
                        } else {
                            node.name = node.tag;
                        }
                    }
                    break;
                case "join":
                    node.class = "join";
                    if (typeof node.properties === "undefined") {
                        node.properties = {};
                    }
                    node.properties.class = "join";
                    node.properties.join = "inner";
                    node.name = node.tag;
                    break;
                case "leftouterjoin":
                    node.class = "join";
                    if (typeof node.properties === "undefined") {
                        node.properties = {};
                    }
                    node.properties.class = "join";
                    node.properties.join = "left";
                    node.name = node.tag;
                    break;
                case "rightouterjoin":
                    node.class = "join";
                    if (typeof node.properties === "undefined") {
                        node.properties = {};
                    }
                    node.properties.class = "join";
                    node.properties.join = "right";
                    node.name = node.tag;
                    break;
                case "fullouterjoin":
                    node.class = "join";
                    if (typeof node.properties === "undefined") {
                        node.properties = {};
                    }
                    node.properties.class = "join";
                    node.properties.join = "full";
                    node.name = node.tag;
                    break;
                case "tablescan":
                case "cursorscan":
                case "tdescan":
                case "tableconstruction":
                case "virtualtable":
                    node.name = node.tag;
                    node.class = 'relation';
                    break;
                default:
                    if (node.properties && node.properties.class) {
                        switch (node.properties.class) {
                            case "logical-expression":
                                handleLogicalExpression2(node);
                                break;
                            case "logical-operator":
                                handleLogicalOperator2(node);
                                break;
                            default:
                                if (node.tag) {
                                    node.name = node.tag;
                                } else {
                                    node.name = JSON.stringify(node);
                                }
                                break;
                        }
                    } else if (node.tag) {
                        node.name = node.tag;
                    } else {
                        node.name = JSON.stringify(node);
                    }
                    break;
            }

            // Do not use the full name if it is too long (to avoid label overlap)
            if (node.name) {
                if (node.name.length > MAX_DISPLAY_LENGTH) {
                    node.fullName = node.name;
                    // Use of ellipsis character …, different from triple dots ...
                    node.name = node.name.substring(0, MAX_DISPLAY_LENGTH) + "…";
                }
            }
        }

        return generateDisplayNames;
    })();

    // Convert JSON per filename extension
    if (convertHyPer) {
        treeData = hyper.convertHyPer(_treeData);
    } else {
        treeData = convertJSON(_treeData);
    }

    // Tag the tree root
    if (!treeData.tag) {
        treeData.tag = "result";
    }

    generateDisplayNames(treeData);

    // Call visit function to establish maxLabelLength
    var totalNodes = 0;
    var maxLabelLength = 0;
    common.visit(treeData, function(d) {
        totalNodes++;
        if (d.name) {
            maxLabelLength = Math.max(d.name.length, maxLabelLength);
        }
    }, function(d) {
        return d.children && d.children.length > 0 ? d.children : null;
    });

    // Limit maximum label length and keep layout tight for short names
    maxLabelLength = Math.min(maxLabelLength, MAX_DISPLAY_LENGTH);

    // Misc. variables
    var i = 0;
    var duration = 750;
    var root;

    // Size of the diagram
    var viewerWidth = window.innerWidth;
    var viewerHeight = window.innerHeight;

    // Orientation mapping
    var orientations = {
        "top-to-bottom": {
            size: [viewerWidth, viewerHeight],
            x: function(d) {
                return d.x;
            },
            y: function(d) {
                return d.y;
            },
            textdimension: function() {
                return "y";
            },
            textdimensionoffset: function(d) {
                return d.children || d._children ? -13 : 13;
            },
            textanchor: function(d) {
                return d.children || d._children ? "middle" : "middle";
            },
            nodesize: function() {
                return [maxLabelLength * 6, maxLabelLength * 6 / 2];
            },
            nodesep: function(a, b) {
                return a.parent === b.parent ? 1 : 1;
            },
            rootx: function(scale) {
                return -root.x0 * scale + viewerWidth / 2;
            },
            rooty: function(_scale) {
                return 50;
            },
            arrowRotation: "270deg"
        },
        "right-to-left": {
            size: [viewerHeight, viewerWidth],
            x: function(d) {
                return viewerWidth - d.y;
            },
            y: function(d) {
                return d.x;
            },
            textdimension: function() {
                return "x";
            },
            textdimensionoffset: function(d) {
                return d.children || d._children ? 10 : -10;
            },
            textanchor: function(d) {
                return (d.children || d._children) ? "start" : "end";
            },
            nodesize: function() {
                return [11.2/* table node diameter */ + 2, maxLabelLength * 6 + 10/* textdimensionoffset */];
            },
            nodesep: function(a, b) {
                return a.parent === b.parent ? 1 : 1.5;
            },
            rootx: function(scale) {
                return -root.x0 * scale + viewerWidth - maxLabelLength * 6;
            },
            rooty: function(scale) {
                return -root.y0 * scale + viewerHeight / 2;
            },
            arrowRotation: "0deg"
        },
        "bottom-to-top": {
            size: [viewerWidth, viewerHeight],
            x: function(d) {
                return d.x;
            },
            y: function(d) {
                return viewerHeight - d.y;
            },
            textdimension: function() {
                return "y";
            },
            textdimensionoffset: function(d) {
                return d.children || d._children ? 13 : -13;
            },
            textanchor: function(d) {
                return d.children || d._children ? "middle" : "middle";
            },
            nodesize: function() {
                return [maxLabelLength * 6, maxLabelLength * 6 / 2];
            },
            nodesep: function(a, b) {
                return a.parent === b.parent ? 1 : 1;
            },
            rootx: function(scale) {
                return -root.x0 * scale + viewerWidth / 2;
            },
            rooty: function(scale) {
                return -root.y0 * scale + viewerHeight - 50;
            },
            arrowRotation: "90deg"
        },
        "left-to-right": {
            size: [viewerHeight, viewerWidth],
            x: function(d) {
                return d.y;
            },
            y: function(d) {
                return d.x;
            },
            textdimension: function() {
                return "x";
            },
            textdimensionoffset: function(d) {
                return d.children || d._children ? -10 : 10;
            },
            textanchor: function(d) {
                return d.children || d._children ? "end" : "start";
            },
            nodesize: function() {
                return [11.2/* table node diameter */ + 2, maxLabelLength * 6 + 10/* textdimensionoffset */];
            },
            nodesep: function(a, b) {
                return a.parent === b.parent ? 1 : 2;
            },
            rootx: function(_scale) {
                // return 50;
                return maxLabelLength * 6;
            },
            rooty: function(scale) {
                return -root.y0 * scale + viewerHeight / 2;
            },
            arrowRotation: "180deg"
        }
    };

    var ooo = orientations[graphOrientation];

    var tree = d3.layout.tree()
        .size(ooo.size);

    // Define a d3 diagonal projection for use by the node paths later on.
    var diagonal = d3.svg.diagonal()
        .projection(function(d) {
            return [ooo.x(d), ooo.y(d)];
        });

    // Initialize tooltip
    var alwaysSuppressedKeys = ["parent", "properties"];
    var debugTooltipKeys = ["_children", "children", "_name", "depth", "id", "x", "x0", "y", "y0"];
    var tip = d3.tip()
        .attr('class', 'd3-tip')
        .offset([-10, 0])
        .html(function(d) {
            var nameText = "";
            var hoverText = "";
            var propertiesText = "";
            for (var key in d) {
                // The display name will be in the top of the tooltip
                if (key === "name") {
                    nameText = "<span style='text-decoration: underline'>" + d[key] + "</span><br />";
                } else if (key === "properties") { // display all of the "properties"
                    var properties = d[key];
                    for (var p in properties) {
                        if ({}.hasOwnProperty.call(properties, p)) {
                            propertiesText += "<span style='color: hsl(309, 84%, 36%)'>" + p + ": </span>";
                            propertiesText += "<span style='color: black'>" + properties[p] + "</span><br />";
                        }
                    }
                } else if (alwaysSuppressedKeys.indexOf(key) >= 0) { // suppress some of the d3 data
                    continue;
                } else if (!DEBUG && debugTooltipKeys.indexOf(key) >= 0) {
                    continue;
                } else if (d[key]) { // only show non-empty data
                    // Trim the data if it comes from a text property
                    if (key === "text") {
                        d[key] = d[key].trim();
                        // If it becomes an empty string, don't display it
                        if (!d[key]) {
                            continue;
                        }
                    }
                    hoverText += "<span style='color: hsl(0, 0%, 50%)'>" + key + ": </span>";
                    hoverText += "<span style='color: black'>" + d[key] + "</span><br />";
                }
            }
            return nameText + hoverText + propertiesText;
        });

    // Define the zoom function for the zoomable tree
    function zoom() {
        svgGroup.attr("transform", "translate(" + d3.event.translate + ")scale(" + d3.event.scale + ")");
    }

    // Define the zoomListener which calls the zoom function on the "zoom" event constrained within the scaleExtents
    var zoomListener = d3.behavior.zoom().scaleExtent([0.1, 5]).on("zoom", zoom);

    // Define the baseSvg, attaching a class for styling and the zoomListener
    var baseSvg = d3.select("#tree-container").append("svg")
        .attr("viewBox", "0 0 " + viewerWidth + " " + viewerHeight)
        .attr("height", viewerHeight)
        .attr("class", "overlay")
        .call(zoomListener);

    // Build the arrow
    baseSvg.append("svg:defs")
      .append("svg:marker")
        .attr("id", "arrow")
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 18)
        .attr("refY", 0)
        .attr("markerWidth", 5)
        .attr("markerHeight", 5)
        .attr("orient", ooo.arrowRotation)
      .append("svg:path")
        .attr("d", "M0,-5L10,0L0,5");

    var defs = baseSvg.select("defs");
    // Build the default symbol. Use this symbol if there is not a better fit
    defs.append("circle")
      .attr("id", "default-symbol")
      .attr("class", "nodeCircle")
      .attr("r", 5);

    // Build the Join symbols. They are just 2 overlapped circles for the most part.
    var radius = 6.0;
    var leftOffset = -3.0;
    var rightOffset = 3.0;

    var leftJoinGroup = defs.append("g")
      .attr("id", "left-join-symbol");
    leftJoinGroup.append("circle")
      .attr("class", "empty-join")
      .attr("r", radius)
      .attr("cx", rightOffset);
    leftJoinGroup.append("circle")
      .attr("class", "fill-join")
      .attr("r", radius)
      .attr("cx", leftOffset);
    leftJoinGroup.append("circle")
      .attr("class", "only-stroke-join")
      .attr("r", radius)
      .attr("cx", rightOffset);

    var rightJoinGroup = defs.append("g")
      .attr("id", "right-join-symbol");
    rightJoinGroup.append("circle")
      .attr("class", "empty-join")
      .attr("r", radius)
      .attr("cx", leftOffset);
    rightJoinGroup.append("circle")
      .attr("class", "fill-join")
      .attr("r", radius)
      .attr("cx", rightOffset);
    rightJoinGroup.append("circle")
      .attr("class", "only-stroke-join")
      .attr("r", radius)
      .attr("cx", leftOffset);

    var fullJoinGroup = defs.append("g")
      .attr("id", "full-join-symbol");
    fullJoinGroup.append("circle")
      .attr("class", "fill-join no-stroke")
      .attr("r", radius)
      .attr("cx", rightOffset);
    fullJoinGroup.append("circle")
      .attr("class", "fill-join")
      .attr("r", radius)
      .attr("cx", leftOffset);
    fullJoinGroup.append("circle")
      .attr("class", "only-stroke-join")
      .attr("r", radius)
      .attr("cx", rightOffset);

    // Drawing inner joins is more complex. We'll clip a circle (with another circle) to get the intersection shape
    defs.append("clipPath")
      .attr("id", "join-clip")
      .append("circle")
        .attr("class", "empty-join")
        .attr("r", radius)
        .attr("cx", leftOffset);

    var innerJoinGroup = defs.append("g")
      .attr("id", "inner-join-symbol");
    innerJoinGroup.append("circle")
      .attr("class", "empty-join")
      .attr("r", radius)
      .attr("cx", leftOffset);
    innerJoinGroup.append("circle")
      .attr("class", "empty-join")
      .attr("r", radius)
      .attr("cx", rightOffset);
    innerJoinGroup.append("circle")
      .attr("class", "fill-join no-stroke")
      .attr("clip-path", "url(#join-clip)")
      .attr("r", radius)
      .attr("cx", rightOffset);
    innerJoinGroup.append("circle")
      .attr("class", "only-stroke-join")
      .attr("r", radius)
      .attr("cx", leftOffset);
    innerJoinGroup.append("circle")
      .attr("class", "only-stroke-join")
      .attr("r", radius)
      .attr("cx", rightOffset);

    // Build the table symbol. Made out of several rectangles.
    var tableRowWidth = 5.2;
    var tableRowHeight = 2.8;
    var tableWidth = tableRowWidth * 3;
    var tableHeight = tableRowHeight * 4;
    var tableStartLeft = -tableWidth / 2;
    var tableStartTop = -tableHeight / 2;

    var tableGroup = defs.append("g")
      .attr("id", "table-symbol");
    tableGroup.append("rect")
      .attr("class", "table-background")
      .attr("x", tableStartLeft)
      .attr("width", tableWidth)
      .attr("y", tableStartTop)
      .attr("height", tableHeight);
    tableGroup.append("rect")
      .attr("class", "table-header")
      .attr("x", tableStartLeft)
      .attr("width", tableWidth)
      .attr("y", tableStartTop)
      .attr("height", tableRowHeight);
    tableGroup.append("rect")
      .attr("class", "table-border")
      .attr("x", tableStartLeft)
      .attr("width", tableWidth)
      .attr("y", 0)
      .attr("height", tableRowHeight);
    tableGroup.append("rect")
      .attr("class", "table-border")
      .attr("x", -tableRowWidth / 2)
      .attr("width", tableRowWidth)
      .attr("y", tableStartTop + tableRowHeight)
      .attr("height", tableHeight - tableRowHeight);

    // Collapse all but me in my parent node
    // Nodes may have children and _children that were children prior to streamline
    function streamline(d) {
        if (d.parent) {
            if (d.parent._children && d.parent._children !== null && d.parent._children.length > 0) {
                // save all of the original children in _chidren one time only
            } else {
                d.parent._children = d.parent.children.slice(0);
            }
            var index = d.parent.children.indexOf(d);
            d.parent.children.splice(index, 1);
        }
    }

    // Return true if node is collapsed
    function collapsed(d) {
        if (d.children && d._children) {
            // Nodes will have fewer children than _children if collapsed by streamline
            if (d.children.length < d._children.length) {
                return true;
            }
            return false;
        }
        if (d._children) {
            return true;
        }
        return false;
    }

    // Collapse all children regardless of the current state
    function collapseChildren(d) {
        var children = (d.children) ? d.children : null;
        var _children = (d._children) ? d._children : null;
        // all original children are in _children or none are
        if (_children === null || _children.length === 0) {
            d._children = children;
        }
        d.children = null;
        return d;
    }

    // Toggle children function, streamlined nodes are partially collapsed
    function toggleChildren(d) {
        var children = (d.children) ? d.children : null;
        var _children = (d._children) ? d._children : null;
        d._children = children;
        d.children = _children;
        return d;
    }

    // Toggle children on click.
    function click(d) {
        d = toggleChildren(d);
        update(d);
    }

    //
    // Update graph at the given source location, which may be the root or a subtree
    //
    function update(source) {
        // Specify size and separation of nodes
        tree = tree.nodeSize(ooo.nodesize()).separation(ooo.nodesep);

        // Compute the new tree layout.
        var nodes = tree.nodes(root).reverse();
        var links = tree.links(nodes);

        // Update the nodes…
        var node = svgGroup.selectAll("g.node")
            .data(nodes, function(d) {
                return d.id || (d.id = ++i);
            });

        // Enter any new nodes at the parent's previous position.
        var nodeEnter = node.enter().append("g")
            .attr("class", "node")
            .attr("transform", function(_d) {
                return "translate(" + source.x0 + "," + source.y0 + ")";
            })
            .on('click', click);

        nodeEnter.append("use")
            .attr("xlink:href", function(d) {
                if (d.properties && d.properties.join && d.class && d.class === "join") {
                    return "#" + d.properties.join + "-join-symbol";
                } else if (d.class && d.class === "relation") {
                    return "#table-symbol";
                } else if (d.properties && d.properties.class && d.properties.class === "createtemptable") {
                    return "#table-symbol";
                }
                return "#default-symbol";
            });

        nodeEnter.append("text")
            .attr(ooo.textdimension(), function(d) {
                return ooo.textdimensionoffset(d);
            })
            .attr("dy", ".35em")
            .attr('class', 'nodeText')
            .attr("text-anchor", function(d) {
                return ooo.textanchor(d);
            })
            .text(function(d) {
                return d.name;
            })
            .style("fill-opacity", 0);

        // Assign federated query color classes
        node.attr("class", function(d) {
            var _class = d3.select(this).attr("class");
            return (d.federated && _class.search(d.federated) === -1 ? _class + " " + d.federated : _class);
        });

        // Update the text to reflect whether node has children or not.
        node.select('text')
            .attr(ooo.textdimension(), function(d) {
                return ooo.textdimensionoffset(d);
            })
            .attr("text-anchor", function(d) {
                return ooo.textanchor(d);
            })
            .text(function(d) {
                return d.name;
            });

        // Change the symbol style class depending on whether it has children and is collapsed
        node.call(tip); // invoke tooltip
        node.select("use")
            .attr("class", function(d) {
                return collapsed(d) ? "collapsed" : "expanded";
            })
            .on('mouseover', tip.show)
            .on('mouseout', tip.hide);

        // Transition nodes to their new position.
        var nodeUpdate = node.transition()
            .duration(duration)
            .attr("transform", function(d) {
                return "translate(" + ooo.x(d) + "," + ooo.y(d) + ")";
            });

        // Fade the text in
        nodeUpdate.select("text")
            .style("fill-opacity", 1);

        // Transition exiting nodes to the parent's new position.
        var nodeExit = node.exit().transition()
            .duration(duration)
            .attr("transform", function(_d) {
                return "translate(" + source.x + "," + source.y + ")";
            })
            .remove();

        nodeExit.select("circle")
            .attr("r", 0);

        nodeExit.select("text")
            .style("fill-opacity", 0);

        // Update the links…
        var link = svgGroup.selectAll("path.link")
            .data(links, function(d) {
                return d.target.id;
            });

        // Enter any new links at the parent's previous position.
        link.enter().insert("path", "g")
            .attr("class", function(d) {
                if (d.source && d.source.tag === "binding") {
                    return "link link-and-arrow";
                }
                return "link";
            })
            .attr("d", function(_d) {
                var o = {
                    x: source.x0,
                    y: source.y0
                };
                return diagonal({
                    source: o,
                    target: o
                });
            });

        // Transition links to their new position.
        link.transition()
            .duration(duration)
            .attr("d", diagonal);

        // Transition exiting nodes to the parent's new position.
        link.exit().transition()
            .duration(duration)
            .attr("d", function(_d) {
                var o = {
                    x: source.x,
                    y: source.y
                };
                return diagonal({
                    source: o,
                    target: o
                });
            })
            .remove();

        // Stash the old positions for transition.
        nodes.forEach(function(d) {
            d.x0 = ooo.x(d);
            d.y0 = ooo.y(d);
        });
    }

    // Append a group which holds all nodes and which the zoom Listener can act upon.
    svgGroup = baseSvg.append("g")
        .attr("class", "main");

    // Define the root
    root = treeData;
    root.x0 = viewerHeight / 2;
    root.y0 = 0;

    // Layout the tree initially and center on the root node.
    update(root);

    // Assign federated query colors
    colors.colorFederated(root);

    // Collapse all non-essential nodes at their respective roots
    if (graphCollapse !== 'n') {
        svgGroup.selectAll("g.node")
            .each(function(d) {
                if (d.name) {
                    var _name = d.fullName ? d.fullName : d.name;
                    switch (_name) {
                        case 'aggregates':
                        case 'builder':
                        case 'cardinality':
                        case 'condition':
                        case 'conditions':
                        case 'count':
                        case 'criterion':
                        case 'datasource':
                        case 'expressions':
                        case 'field':
                        case 'from':
                        case 'groupbys':
                        case 'header':
                        case 'imports':
                        case 'operatorId':
                        case 'matchMode':
                        case 'measures':
                        case 'metadata-record':
                        case 'metadata-records':
                        case 'method':
                        case 'output':
                        case 'orderbys':
                        case 'predicate':
                        case 'residuals':
                        case 'restrictions':
                        case 'runquery-columns':
                        case 'segment':
                        case 'selects':
                        case 'schema':
                        case 'tid':
                        case 'top':
                        case 'tuples':
                        case 'values':
                            if (graphCollapse === 's') {
                                streamline(d);
                            } else {
                                toggleChildren(d);
                            }
                            return;
                        default:
                            break;
                    }
                }
                if (d.class) {
                    switch (d.class) {
                        case 'relation':
                            collapseChildren(d);
                            return;
                        default:
                            break;
                    }
                }
                if (d.tag) {
                    switch (d.tag) {
                        case 'header':
                        case 'values':
                        case 'tid':
                            if (graphCollapse === 's') {
                                streamline(d);
                            } else {
                                toggleChildren(d);
                            }
                            return;
                        default:
                            break;
                    }
                }
            });
    }

    // Update the tree after all non-essential nodes are collapsed
    update(root);

    // Place root node into quandrant appropriate to orientation
    function orientRoot() {
        var scale = zoomListener.scale();
        var x = ooo.rootx(scale);
        var y = ooo.rooty(scale);
        d3.select('g.main').transition()
            .duration(duration)
            .attr("transform", "translate(" + x + "," + y + ")scale(" + scale + ")");
        zoomListener.scale(scale);
        zoomListener.translate([x, y]);
    }

    // Handle selected keyboard events
    d3.select('body')
        .on("keydown", function() {
            // Emit event key codes for debugging
            if (DEBUG) {
                baseSvg.append("text")
                    .attr("x", "5")
                    .attr("y", "150")
                    .style("font-size", "50px")
                    .text("keyCode: " + d3.event.keyCode)
                    .transition().duration(2000)
                    .style("font-size", "5px")
                    .style("fill-opacity", ".1")
                    .remove();
            }

            // On space, expand all currently visible collapsed nodes, that is all for now
            // Subsequent uses may expand additional visible nodes that are now visible
            // Refresh browser window to get back to baseline
            if (d3.event.keyCode === 32) {
                svgGroup.selectAll("g.node")
                    .each(function(d) {
                        if (collapsed(d)) {
                            toggleChildren(d);
                        }
                    });
                update(root);
                orientRoot();
            }
        });

    // Scale for readability by a fixed amount due to problematic .getBBox() above
    var dscale = zoomListener.scale();
    d3.select('g.main').transition()
        .duration(duration)
        .attr("transform", "scale(" + dscale + ")");
    zoomListener.scale(dscale * 1.5);

    orientRoot();

    // Add metrics card
    var treeText = "";
    if (!inlineString) {
        treeText += "<span style='color: hsl(309, 84%, 36%)'>file: </span>";
        treeText += "<span style='color: black'>" + graphFile + "</span><br />";
    }
    treeText += "<span style='color: hsl(309, 84%, 36%)'>nodes: </span>";
    treeText += "<span style='color: black'>" + totalNodes + "</span><br />";
    $("#tree-label").html(treeText);
});


// Require node.js modules
var path = require('path');

// Require local modules
var common = require('./common');
var knownLoaders = {
    hyper: require('./hyper').loadHyperPlan,
    tableau: require('./tableau').loadTableauPlan,
    json: require('./json').loadJson,
    xml: require('./xml').loadXml,
    raw: JSON.parse
};

// Require node modules
var $ = require('jquery');
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

// Get file format
var fileFormat = queryObject.format;
if (fileFormat !== undefined && !knownLoaders.hasOwnProperty(fileFormat)) {
    document.write("File format '" + fileFormat + "' not supported.");
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

// Get properties to be rendered in the toplevel info card
var toplevelProperties;
if (queryObject.properties) {
    try {
        toplevelProperties = JSON.parse(queryObject.properties);
    } catch (err) {
        document.write("JSON parse failed with '" + err + "'.");
    }
} else {
    toplevelProperties = {};
}

// Add the file name to the displayed properties
if (!inlineString) {
    toplevelProperties.file = graphFile;
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
// Create the symbols
//
function defineSymbols(baseSvg, ooo) {
    baseSvg.append("svg:defs");
    var defs = baseSvg.select("defs");
    // Build the arrow
    defs.append("svg:marker")
        .attr("id", "arrow")
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 18)
        .attr("refY", 0)
        .attr("markerWidth", 5)
        .attr("markerHeight", 5)
        .attr("orient", ooo.arrowRotation)
      .append("svg:path")
        .attr("d", "M0,-5L10,0L0,5");

    // Build the default symbol. Use this symbol if there is not a better fit
    defs.append("circle")
      .attr("id", "default-symbol")
      .attr("class", "nodeCircle")
      .attr("r", 5);

    // Build the run query symbol
    var runQueryGroup = defs.append("g")
      .attr("id", "run-query-symbol");
    runQueryGroup.append("circle")
      .attr("class", "nodeCircle")
      .attr("r", 6);
    runQueryGroup.append("path")
      .attr("class", "run-query")
      .attr("d", "M-2.5,-3.5L4,0L-2.5,3.5 z");

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

    // Build the temp table symbol, very similar to the regular table symbol
    var tempTableGroup = defs.append("g")
      .attr("id", "temp-table-symbol");
    tempTableGroup.append("rect")
      .attr("class", "table-background")
      .attr("x", tableStartLeft)
      .attr("width", tableWidth)
      .attr("y", tableStartTop)
      .attr("height", tableHeight);
    tempTableGroup.append("rect")
      .attr("class", "table-header")
      .attr("x", tableStartLeft)
      .attr("width", tableWidth)
      .attr("y", tableStartTop)
      .attr("height", tableRowHeight);
    tempTableGroup.append("text")
      .attr("class", "table-text")
      .attr("y", 4)
      .attr("font-size", "8px")
      .text("TMP");
}

//
// Abbreviate all names if they are too long
//
function abbreviateNames(treeData) {
    common.visit(treeData, function(node) {
        // Do not use the full name if it is too long (to avoid label overlap)
        if (node.name && node.name.length > MAX_DISPLAY_LENGTH) {
            node.fullName = node.name;
            // Use of ellipsis character …, different from triple dots ...
            node.name = node.name.substring(0, MAX_DISPLAY_LENGTH) + "…";
        }
    }, common.allChildren);
}

//
// Escapes a string for HTML
//
function escapeHtml(unsafe) {
    return (String(unsafe)).replace(/&/g, "&amp;")
        .replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

//
// Draw query tree
//
// The treedata is an object with the following properties:
//   * root: the root node; its format is described below
//   * properties: displayed in the top-level tree label
//
// Each root node has the following properies:
//   * name: the displayed node name
//   * symbol: the id of the symbol for this node
//   * nodeClass: additional CSS classes applied to the node
//   * edgeClass: additional CSS classes applied to the incoming link
//   * properties: rendered in the tooltip
//   * children: an array containing all currently visible child nodes
//   * _children: an array containing all child nodes, including hidden nodes
//   * <most other>: displayed as part of the tooltip
function drawQueryTree(treeData) {
    var root = treeData.root;
    // Call visit function to establish maxLabelLength
    var totalNodes = 0;
    var maxLabelLength = 0;
    common.visit(root, function(d) {
        totalNodes++;
        if (d.name) {
            maxLabelLength = Math.max(d.name.length, maxLabelLength);
        }
    }, common.allChildren);

    // Limit maximum label length and keep layout tight for short names
    maxLabelLength = Math.min(maxLabelLength, MAX_DISPLAY_LENGTH);

    // Misc. variables
    var i = 0;
    var duration = 750;

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
                return 100;
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
    var diagonalRaw = d3.svg.diagonal();
    var diagonal = d3.svg.diagonal()
        .projection(function(d) {
            return [ooo.x(d), ooo.y(d)];
        });

    // Build a HTML list of properties to be displayed in a tooltip
    function buildPropertyList(properties, cssClass) {
        cssClass = cssClass === undefined ? "prop-name" : cssClass;
        var html = "";
        Object.getOwnPropertyNames(properties).forEach(function(key) {
            html += "<span class='" + cssClass + "'>" + escapeHtml(key) + ": </span>";
            html += "<span style='prop-value'>" + escapeHtml(properties[key]) + "</span><br />";
        });
        return html;
    }

    // Helper function to retrieve all properties of the node object which should be rendered in the tooltip
    var alwaysSuppressedKeys = ["name", "properties", "parent", "properties", "symbol", "nodeClass", "edgeClass"];
    var debugTooltipKeys = ["_children", "children", "_name", "depth", "id", "x", "x0", "y", "y0"];
    function getDirectProperties(d) {
        var props = {};
        Object.getOwnPropertyNames(d).forEach(function(key) {
            if (alwaysSuppressedKeys.indexOf(key) >= 0) { // suppress some of the d3 data
                return;
            } else if (!DEBUG && debugTooltipKeys.indexOf(key) >= 0) {
                return;
            } else if (d[key]) { // only show non-empty data
                props[key] = d[key];
            }
        });
        return props;
    }

    // Initialize tooltip
    var tip = d3.tip()
        .attr('class', 'd3-tip')
        .offset([-10, 0])
        .html(function(d) {
            var nameText = "<span style='text-decoration: underline'>" + escapeHtml(d.name) + "</span><br />";
            var directPropsText = buildPropertyList(getDirectProperties(d), "props2-name");
            var propertiesText = d.hasOwnProperty("properties") ? buildPropertyList(d.properties) : "";
            return nameText + directPropsText + propertiesText;
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

    defineSymbols(baseSvg, ooo);

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
            .attr("class", function(d) {
                return d.hasOwnProperty("nodeClass") ? d.nodeClass + " node" : "node";
            })
            .attr("transform", function(_d) {
                return "translate(" + source.x0 + "," + source.y0 + ")";
            })
            .on('click', click);

        nodeEnter.append("use")
            .attr("xlink:href", function(d) {
                if (d.symbol) {
                    return "#" + d.symbol;
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
        node.select("use")
            .attr("class", function(d) {
                return collapsed(d) ? "collapsed" : "expanded";
            });

        // Add tooltips
        node.filter(function(d) {
                return Object.getOwnPropertyNames(getDirectProperties(d)).length ||
                       (d.hasOwnProperty("properties") && Object.getOwnPropertyNames(d.properties).length);
            })
            .call(tip) // invoke tooltip
            .select("use")
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
                return "translate(" + ooo.x(source) + "," + ooo.y(source) + ")";
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
                if (d.target.hasOwnProperty("edgeClass")) {
                    return "link " + d.target.edgeClass;
                }
                return "link";
            })
            .attr("d", function(_d) {
                var o = {
                    x: source.x0,
                    y: source.y0
                };
                return diagonalRaw({
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
    var origin = {x: 0, y: 0};
    root.x0 = ooo.x(origin);
    root.y0 = ooo.y(origin);

    // Layout the tree initially and center on the root node.
    update(root);

    // Place root node into quandrant appropriate to orientation
    function orientRoot() {
        var scale = zoomListener.scale();
        var x = ooo.rootx(scale);
        var y = ooo.rooty(scale);
        d3.select('g.main')
            .attr("transform", "translate(" + x + "," + y + "),scale(" + scale + ")");
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
    zoomListener.scale(zoomListener.scale() * 1.5);

    orientRoot();

    // Add metrics card
    var treeText = "";
    var properties = treeData.properties ? treeData.properties : {};
    treeText += buildPropertyList(properties);
    treeText += buildPropertyList({nodes: totalNodes});
    $("#tree-label").html(treeText);
}

//
// Retrieve graph data
//
function retrieveData(callback) {
    if (inlineString) {
        callback(null, inlineString);
    } else {
        d3.text(directory + graphFile, callback);
    }
}

//
// Kick it off
//
retrieveData(function(err, graphString) {
    if (err) {
        document.write("Request for '" + directory + graphFile + "' failed with '" + err + "'.");
        return;
    }

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
    } else {
        loaders = [knownLoaders.tableau, knownLoaders.hyper, knownLoaders.xml, knownLoaders.json];
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
        abbreviateNames(loadedTree.root);
        if (loadedTree.properties === undefined) {
            loadedTree.properties = {};
        }
        Object.getOwnPropertyNames(toplevelProperties).forEach(function(key) {
            loadedTree.properties[key] = toplevelProperties[key];
        });
        spinner.stop();
        drawQueryTree(loadedTree);
    } else {
        spinner.stop();
        document.write(errors.reduce(function(a, b) {
            return a + "<br/>" + b;
        }));
    }
});

Query Graphs
============
[![Community Supported](https://img.shields.io/badge/Support%20Level-Community%20Supported-457387.svg)](https://www.tableau.com/support-levels-it-and-developer-tools)

Helping people see and understand queries.

![Query Visualization](https://tableau.github.io/query-graphs/standalone-server/media/sample_graph.png "Sample Graph")

Description
-----------

Query Graphs is an investigation into graph visualization for query processing, such as for logical queries and their physical
query evaluation plans.
Current visualizations are tailored for artifacts from Tableau's query ecosystem:
LogicalQuery XML, QueryFunction XML, and Hyper query-plan JSON.
Query Graphs is also used by the
[Tableau Log Viewer](https://github.com/tableau/tableau-log-viewer)
to visualize query artifacts in Tableau's log files.

View example query visualizations at
* <https://tableau.github.io/query-graphs/standalone-server/webroot/query-graphs.tlv.html?file=tableau/joins.xml>,
* <https://tableau.github.io/query-graphs/standalone-server/webroot/query-graphs.tlv.html?file=tableau/query-function.xml&collapse=n>,
* <https://tableau.github.io/query-graphs/standalone-server/webroot/query-graphs.tlv.html?file=tableau/dint4.xml>,
* <https://tableau.github.io/query-graphs/standalone-server/webroot/query-graphs.tlv.html?file=hyper/query2.json>,
* <https://tableau.github.io/query-graphs/standalone-server/webroot/query-graphs.tlv.html?file=hyper/steps2.json&orientation=left-to-right>, or
* <https://tableau.github.io/query-graphs/standalone-server/webroot/query-graphs.tlv.html?file=tql/iejoin.tql>

Project Structure
-------------------

This repository is a monorepo currently consisting of the following projects:

* `query-graphs`: the reusable tree-loading and rendering components
* `standalone-server`: a stand-alone server which allows to visualize query plans

Installation
------------

Install latest stable version (at least 5.8.0) of Node.js from <http://nodejs.org>.

Run git clone on the query-graphs project, install node module dependencies, and
start the visualization service.
Install also creates minified bundles for the visualization service and for use in the Tableau Log Viewer.

```shell
git clone https://github.com/tableau/query-graphs.git
cd query-graphs/query-graphs
npm install (or npm install --production for an install with no development dependencies)
cd ../standalone-server
npm install (or npm install --production for an install with no development dependencies)
node upload-server.js
```

After local installation and server start, open example query visualizations file at
* <http://localhost:3000/query-graphs.html?file=tableau/joins.xml>,
* <http://localhost:3000/query-graphs.html?file=tableau/query-function.xml&collapse=n>,
* <http://localhost:3000/query-graphs.html?file=tableau/dint4.xml>,
* <http://localhost:3000/query-graphs.html?file=hyper/query2.json>, or
* <http://localhost:3000/query-graphs.html?file=hyper/steps2.json&orientation=left-to-right>,
* <http://localhost:3000/query-graphs.html?file=tql/iejoin.tql>,

Open the upload form at
<http://localhost:3000/upload-form.html>.
LogicalQuery XML, QueryFunction XML, or Hyper query-plan JSON, as files or text,
may be uploaded to the express service for visualization.

Open the side-by-side query comparison at
<http://localhost:3000/compare-layout.html>.

Query String Parameters
-----------------------

The following URL parameters are supported for query visualization:

```
Parameter       | Description
---------       | -----------
collapse        | node collapse style: n - no/none, y - yes/some, s - streamline all secondary nodes (default)
debug           | debug mode: any setting will enable (disabled by default)
file            | name of XML file: (default file name if not specified)
format          | format of the file: 'tableau', 'hyper', 'xml', 'json' (default: file format will be inferred)
orientation     | graph orientation: top-to-bottom (default), right-to-left, bottom-to-top, left-to-right
upload          | query uploaded: y - query was uploaded to the visualization service, n - (default)
properties      | JSON object with additional properties to be displayed in the tree label

```

The following URL parameters are supported for side-by-side comparisons:

```
Parameter       | Description
---------       | -----------
left            | name of file to render in the left iframe
left-label      | label of the left iframe
right           | name of file to render in the right iframe
right-label     | label of the right iframe
```

Building and Linting
---------------------

Build instructions to create the JavaScript bundle containing all required dependencies.
Run after any changes to query-graphs.js or its module dependencies.

```shell
cd standalone-server
npm run bundle
```

To create an archive containing the bundle and associated files for the Tableau Log Viewer, run
the following. Extract the archive in tlv-qt/query-graphs, a subdirectory in the tlv-qt project.

```shell
cd standalone-server
npm run bundle-tlv
```

To run eslint on the appropriate JavaScript files, do the following within the project root.
(The eslint is a development dependency in package.json;
its installation could be avoided by using **npm install --production** above.)

```shell
npm run lint
```

Acknowledgements
----------------

The dragging, zooming, panning, collapsing functionality originated from
“D3.js Drag and Drop, Zoomable, Panning, Collapsible Tree with Auto-Sizing” (Rob Schmuecker’s block #7880033).

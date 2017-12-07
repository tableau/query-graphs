Query Graphs
============

Helping people see and understand queries.

Description
-----------

Query Graphs is an investigation into graph visualization for query processing, such as for logical queries and their physical
query evaluation plans. The project tag line is "Helping people see and understand queries."
The technology stack for query visualization consists of
**browserify**, 
**jquery.js**,
**d3.js**,
**d3-tip.js**, 
**http-server**, and
**xml2js**.
Browserify is used to satisfy required dependencies.

The following additional resources are required for query visualization as an express service:
**body-parser.js**,
**bootstrap**,
**crypto.js**,
**express.js**,
**fs.js**,
**multer.js**, and
**node.js**.
Node is used to start the Express service.
If running query visualization as a service, then a separate http-server is not required.

There is also a side-by-side comparison layout for comparing two queries at once.

Directory Structure
-------------------

```
Directory       | Description
---------       | -----------
d3              | query visualization artifacts
media           | screen captures, sample queries, uploads
result-table    | for side-by-side query comparisons
```

Installation
------------

Install latest stable version (at least 5.8.0) of Node.js from <http://nodejs.org>.

Run git clone on the query-graphs project, install node module dependencies, and
start the visualization service.
Install also creates browserify bundles for the visualization service and for use in the Tableau Log Viewer.

```shell
git clone https://github.com/tableau/query-graphs.git
cd query-graphs
npm install (or npm install --production for an install with no development dependencies)
node upload-server.js
```

Example Visualizations
----------------------

Open an examplar query html file at 
* <http://localhost:3000/d3/query-graphs.html>, 
* <http://localhost:3000/d3/query-graphs.html?file=joins.xml>,
* <http://localhost:3000/d3/query-graphs.html?file=query-function.xml&collapse=n>,
* <http://localhost:3000/d3/query-graphs.html?file=dint4.xml>,
* <http://localhost:3000/d3/query-graphs.html?file=hyper-query2.json>, or
* <http://localhost:3000/d3/query-graphs.html?file=hyper-steps2.json&orientation=left-to-right>,

Open the upload form at 
<http://localhost:3000/d3/upload-form.html>.
LogicalQuery XML, QueryFunction XML, or HyPer query-plan JSON, as files or text, 
may be uploaded to the express service for visualization.

Open the side-by-side query comparison at 
<http://localhost:3000/result-table/compare_layout.html?left=3d5c935c.xml&right=3d5c935c.xml&left-label=before&right-label=after>.

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

Browserify and ESLint
---------------------

Build instructions to create the JavaScript bundle containing all required dependencies.
Run after any changes to query-graphs.js or its module dependencies.

```shell
npm run bundle
```

To create an archive containing the bundle and associated files for the Tableau Log Viewer, run
the following. Extract the archive in tlv-qt/query-graphs, a subdirectory in the tlv-qt project.

```shell
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

The dragging, zooming, panning, panning, collapsing functionality originated from 
“D3.js Drag and Drop, Zoomable, Panning, Collapsible Tree with Auto-Sizing” (Rob Schmuecker’s block #7880033).


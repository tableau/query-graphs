Query Graphs stand-alone server
============
[![Community Supported](https://img.shields.io/badge/Support%20Level-Community%20Supported-457387.svg)](https://www.tableau.com/support-levels-it-and-developer-tools)

Helping people see and understand queries.

![Query Visualization](https://tableau.github.io/query-graphs/media/sample_graph.png "Sample Graph")

Description
-----------

This package provides a simple stand-alone web-server.
Users can upload query plans to this server to visualize them.

The server stores the uploaded query plans for some time, so that the resulting links can be shared with team members through email/Slack.

Installation
------------

1. Install NodeJS and npm (if you don't have them installed, yet)
2. Clone this repository
3. Inside this folder run `npm install`
4. Start the server by running `node upload-server.js`

In other words:
```shell
git clone https://github.com/tableau/query-graphs.git
cd query-graphs/standalone-server
npm install
node upload-server.js
```

After local installation and server start, you should be able to open the example
for logical query visualization at <http://localhost:3000/query-graphs.html?file=tableau/joins.xml>, and example for 
aql table query visualization at <http://localhost:3000/query-graphs.html?file=tableau/aql-table-query-example.xml>.

You can get a complete list of all example visualizations on <http://localhost:3000/favorites>.
Feel free to explore them.

You can open the upload form at <http://localhost:3000/> and upload query plans by choosing a
local file or by copy-pasting the query plan.

You can find a side-by-side query comparison at
<http://localhost:3000/compare-layout.html>.

Query String Parameters
-----------------------

The following URL parameters are supported for query visualization:

```
Parameter       | Description
---------       | -----------
collapse        | node collapse style: n - no/none, y - yes/some, s - streamline all secondary nodes (default)
debug           | debug mode: any setting will enable (disabled by default)
file            | name of file to display
format          | format of the file: 'tableau', 'hyper', 'xml', 'tql', 'postgres', 'json' (default: file format will be inferred)
orientation     | graph orientation: top-to-bottom (default), right-to-left, bottom-to-top, left-to-right
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

Development
-----------

As long as you are only working on files within the
`standalone-server` subdirectory, you can run `npm run bundle`
to recreate the JS and CSS bundles.

By default, this project uses the version of `query-graphs` which was
officially released and published to the npm registry.
If you want to pull in changes from an unpublished version, e.g. during testing
your newly added improvements, you can either
* use `npm link` to temporarily link the unpublished version of the query-graphs library into this project (see [documentation of npm link](https://docs.npmjs.com/cli/link))
* replace the `"@tableau/query-graphs": "^2.0.0"` dependency in the package.json by `"@tableau/query-graphs": "file:../query-graphs"`

We use eslint to lint our JavaScript code.
To run eslint on the appropriate files, you can use `npm run lint` inside this directory.

There are no automated test cases, yet.
For now, we manually verify that all example query plans render as expected.

Integration into Table Log Viewer
-----------

To create an archive containing the bundle and associated files for the Tableau Log Viewer, use `npm run bundle-tlv`.
Extract the archive in tlv-qt/query-graphs, a subdirectory in the tlv-qt project.

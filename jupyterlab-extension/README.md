Query Graphs JupyterLab extension
============
[![Community Supported](https://img.shields.io/badge/Support%20Level-Community%20Supported-457387.svg)](https://www.tableau.com/support-levels-it-and-developer-tools)

A JupyterLab extension helping people see and understand queries.

![Screenshot of the JupyterLab extension in action](https://tableau.github.io/query-graphs/media/jupyterlab-screenshot.png)


## Prerequisites

* JupyterLab

## Installation

```bash
jupyter labextension install @tableau/query-graphs-jupyterlab-extension
```

## Development

For a development install of this extension, do the following in the this directory:

```bash
npm install
jupyter labextension link .
```

To rebuild the package and the JupyterLab app:

```bash
npm run build
jupyter lab build
```

By default, the JupyterLab extension picks up the version of `query-graphs` which was
officially released and published to the npm registry.
If you want to pull in changes from an unpublished version, e.g. during testing
your newly added improvements, you can either
* use `jupyter labextension link` to temporarily link the unpublished version of the query-graphs library into JupyterLab, or
* replace the `"@tableau/query-graphs": "^2.0.0"` dependency in the package.json by `"@tableau/query-graphs": "file:/absolute/path/to/query-graphs/query-graphs"`. Note that a relative path won't work.

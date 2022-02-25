## Building & Local deployment

1. Install yarn (not npm!)
2. Run the following commands

```shell
git clone https://github.com/tableau/query-graphs.git
cd query-graphs/standalone-app
yarn install
yarn run --cwd=../query-graphs build
yarn run build
node run prod-server
```

and open `localhost:8080`.

## Project Structure

This repository is a monorepo currently consisting of the following submodules:

* `query-graphs`: core functionality, i.e. the loading and rendering of query plans.
* `standalone-app`: a stand-alone app containing the "shell" around the rendering functionality provided by the `query-graphs` library. Provides, e.g., the UI to open a file or copy-paste a query plan.
* `upload-server`: a file-server which can be used to create shareable links for query plans
* `plan-dumper`: utility scripts to refresh the demo query plans committed insides this repository

You probably care most about `query-graphs` and `standalone-app` which provide the main functionality for query plan visualization.

## Modifying `standalone-app`

The stand-alone app contains all the auxiliary functionality (file opening, sharing, ...) around the actual `query-graphs` core library. It is written in TypeScript on top of the React framework.

After your initial build following the instructions above, you use `yarn dev-server` inside the `standalone-app` folder to start a development server on `localhost:8080`. This server will automatically re-compile and reload the app, as you save your to the TypeScript files.

## Modifying `query-graphs`

The `query-graphs` library contains all logic around parsing and rendering of query plans.
If you want to add, e.g., support for a new query plan format, tweak some color highlighting or add other new visualization features, this is the code which you want to modify.

The `query-graphs` folder does not provide an UI on its own.
To see your changes in action, you will have to use the interface provided by `standalone-app`.
To do so, run `yarn dev-server` inside the `standalone-app` folder and connect to the UI on `localhost:8080`.
Changes inside the `query-graphs` directory are not immediately picked up by the `standalone-app`. 
For your changes to take effect, you will have to re-run `yarn build` inside the `query-graphs` folder.

## Linting

We use eslint as our code linter.
To run eslint, use `yarn run lint` inside the top-level directory of the repository.
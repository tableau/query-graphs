import type {Configuration} from "webpack";
import {DefinePlugin} from "webpack";
import {execFileSync} from "node:child_process";
import path from "path";
import CopyPlugin from "copy-webpack-plugin";
import {CreateExamplesListPlugin} from "./webpack-create-examples-list";
import FaviconsWebpackPlugin from "favicons-webpack-plugin";
import HtmlWebpackPlugin from "html-webpack-plugin";

const repositoryRoot = path.resolve(__dirname, "../..");

function getBuildCommitHash(): string {
    const environmentCommitHash = process.env.BUILD_COMMIT_HASH ?? process.env.GITHUB_SHA;
    if (environmentCommitHash !== undefined) {
        return environmentCommitHash.trim();
    }

    try {
        return execFileSync("git", ["rev-parse", "HEAD"], {cwd: repositoryRoot, encoding: "utf8"}).trim();
    } catch {
        return "unknown";
    }
}

const buildCommitHash = getBuildCommitHash();

function getBuildCommitTimestamp(): string {
    const environmentTimestamp = process.env.BUILD_COMMIT_TIMESTAMP;
    if (environmentTimestamp !== undefined) {
        return environmentTimestamp.trim();
    }

    try {
        return execFileSync("git", ["show", "-s", "--format=%cI", buildCommitHash], {
            cwd: repositoryRoot,
            encoding: "utf8",
        }).trim();
    } catch {
        return "unknown";
    }
}

function formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
        return timestamp;
    }
    return date
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, " UTC");
}

const buildTimestamp = formatTimestamp(getBuildCommitTimestamp());

const config: Configuration = {
    entry: {
        bundle: "./src/index.tsx",
    },
    plugins: [
        new DefinePlugin({
            BUILD_COMMIT_HASH: JSON.stringify(buildCommitHash),
            BUILD_TIMESTAMP: JSON.stringify(buildTimestamp),
        }),
        new HtmlWebpackPlugin({
            title: "Query Graphs",
            filename: "index.html",
            chunks: ["bundle"],
        }),
        new FaviconsWebpackPlugin({
            logo: "../media/query-graphs-logo.svg",
            manifest: "./src/manifest.json",
            favicons: {
                icons: {
                    appleStartup: false,
                },
            },
        }),
        new CopyPlugin({patterns: ["../media/query-graphs-logo.svg", "examples/**"]}),
        new CreateExamplesListPlugin(),
    ],
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: "ts-loader",
                exclude: /node_modules/,
            },
            {
                test: /\.css$/,
                use: ["style-loader", "css-loader"],
            },
        ],
    },
    resolve: {
        extensions: [".tsx", ".ts", ".js"],
        alias: {
            /* to enable tracing in a production build:
            'react-dom$': 'react-dom/profiling',
            'scheduler/tracing': 'scheduler/tracing-profiling',
            */
        },
    },
    output: {
        filename: "[name].js",
        path: path.resolve(__dirname, "..", "dist"),
        clean: true,
    },
};

export default config;

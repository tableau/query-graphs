import {merge} from "webpack-merge";
import type {Configuration as DevServerConfiguration} from "webpack-dev-server";
import path from "path";
import commonConfig from "./common.config";

const devServer: DevServerConfiguration = {
    static: {
        directory: path.resolve(__dirname, "../.generated-examples"),
        publicPath: "/generated-examples",
    },
};

const devConfig = merge(commonConfig, {
    mode: "development",
    devtool: "inline-source-map",
    devServer,
});

export default devConfig;

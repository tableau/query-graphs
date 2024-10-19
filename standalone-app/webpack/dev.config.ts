import {merge} from "webpack-merge";
import commonConfig from "./common.config";

const devConfig = merge(commonConfig, {
    mode: "development",
    devtool: "inline-source-map",
});

export default devConfig;

import {Buffer} from "node:buffer";
import {mkdirSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import process from "node:process";
import {fileURLToPath} from "node:url";

const targetBytes = 10 * 1024 * 1024;
const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), "../.generated-examples/synthetic-10mb-hyper.plan.json");
const statistics = Object.fromEntries(Array.from({length: 2048}, (_, index) => [`metric-${index}`, index]));
const child = JSON.stringify({
    operator: "table-scan",
    "debug-name": {value: "lineitem"},
    table: "lineitem",
    schema: "public",
    "estimated-rows": 6_000_000,
    statistics,
    output: ["l_orderkey", "l_partkey", "l_quantity", "l_extendedprice"],
    predicate: "l_shipdate >= date '1994-01-01' and l_discount between 0.05 and 0.07",
});
const prefix = '{"operator":"union-all","inputs":[';
const inputCount = Math.floor((targetBytes - prefix.length - 2) / (child.length + 1));
const planWithoutPadding = prefix + Array(inputCount).fill(child).join(",") + "]";
const paddingEnvelope = ',"padding":""}';
const paddingLength = targetBytes - Buffer.byteLength(planWithoutPadding + paddingEnvelope);
if (paddingLength < 0) throw new Error("Synthetic plan exceeded its target size");

const plan = planWithoutPadding + ',"padding":"' + "x".repeat(paddingLength) + '"}';
if (Buffer.byteLength(plan) !== targetBytes) throw new Error("Synthetic plan has the wrong size");

mkdirSync(dirname(outputPath), {recursive: true});
writeFileSync(outputPath, plan);
process.stdout.write(`Wrote ${Buffer.byteLength(plan)} bytes with ${inputCount + 1} operators to ${outputPath}\n`);

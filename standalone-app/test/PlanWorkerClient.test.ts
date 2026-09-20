import assert from "node:assert/strict";
import test from "node:test";
import type {PlanWorkerRequest, PlanWorkerResponse} from "../src/PlanWorkerProtocol";
import {loadPlanInWorker, runPlanWorker} from "../src/PlanWorkerClient";

class FakeWorker {
    onmessage: ((event: MessageEvent<PlanWorkerResponse>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    request?: PlanWorkerRequest;
    terminated = false;

    postMessage(request: PlanWorkerRequest): void {
        this.request = request;
    }

    terminate(): void {
        this.terminated = true;
    }

    respond(response: PlanWorkerResponse): void {
        this.onmessage?.({data: response} as MessageEvent<PlanWorkerResponse>);
    }
}

test("plan worker requests resolve and terminate their worker", async () => {
    const worker = new FakeWorker();
    const request = {operation: "validate", text: "{}"} as const;
    const result = runPlanWorker(request, new AbortController().signal, () => worker as unknown as Worker);

    assert.deepEqual(worker.request, request);
    worker.respond({ok: true, operation: "validate"});
    assert.deepEqual(await result, {ok: true, operation: "validate"});
    assert.equal(worker.terminated, true);
});

test("loaded plans restore canonical source text omitted from the worker result", async () => {
    const worker = new FakeWorker();
    const text = 'explain output\r\n{"operator":"table-scan"}\r\ntrailer';
    const result = loadPlanInWorker(text, new AbortController().signal, () => worker as unknown as Worker);

    worker.respond({
        ok: true,
        operation: "load",
        plan: {
            format: "hyper",
            tree: {
                root: {name: "Table Scan"},
                textDocuments: [{id: "plan", title: "Query Plan", text: "", language: "json"}],
            },
        },
        planText: new TextEncoder().encode('{\n   "operator": "table-scan"\n}').buffer as ArrayBuffer,
    });

    assert.equal((await result).tree.textDocuments?.[0].text, '{\n   "operator": "table-scan"\n}');
    assert.equal(worker.terminated, true);
});

test("aborting plan work terminates the worker and ignores late results", async () => {
    const worker = new FakeWorker();
    const abortController = new AbortController();
    const result = runPlanWorker({operation: "load", text: "{}"}, abortController.signal, () => worker as unknown as Worker);

    abortController.abort();
    worker.respond({ok: true, operation: "validate"});
    await assert.rejects(result, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
    assert.equal(worker.terminated, true);
});

test("plan worker runtime failures reject and terminate", async () => {
    const worker = new FakeWorker();
    const result = runPlanWorker(
        {operation: "validate", text: "{}"},
        new AbortController().signal,
        () => worker as unknown as Worker,
    );

    worker.onerror?.({message: "worker crashed"} as ErrorEvent);
    await assert.rejects(result, /worker crashed/);
    assert.equal(worker.terminated, true);
});

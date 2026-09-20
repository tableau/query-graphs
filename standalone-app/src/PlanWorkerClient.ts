import type {LoadedPlan} from "@tableau/query-graphs/lib/loaders";
import {planDocumentId, type PlanWorkerRequest, type PlanWorkerResponse, type SerializedPlanError} from "./PlanWorkerProtocol";

export type PlanWorkerFactory = () => Worker;

function createPlanWorker(): Worker {
    return new Worker(new URL(/* webpackChunkName: "plan-loader" */ "./PlanWorker.ts", import.meta.url));
}

function deserializeError(error: SerializedPlanError): Error {
    const result = new Error(error.message);
    result.name = error.name;
    if (error.stack !== undefined) result.stack = error.stack;
    return result;
}

function abortError(): DOMException {
    return new DOMException("Plan processing was aborted", "AbortError");
}

export function runPlanWorker(
    request: PlanWorkerRequest,
    signal: AbortSignal,
    workerFactory: PlanWorkerFactory = createPlanWorker,
): Promise<PlanWorkerResponse> {
    if (signal.aborted) return Promise.reject(abortError());

    return new Promise((resolve, reject) => {
        const worker = workerFactory();
        let settled = false;

        const finish = (complete: () => void) => {
            if (settled) return;
            settled = true;
            signal.removeEventListener("abort", onAbort);
            worker.terminate();
            complete();
        };
        const onAbort = () => finish(() => reject(abortError()));

        worker.onmessage = ({data}: MessageEvent<PlanWorkerResponse>) => finish(() => resolve(data));
        worker.onerror = (event) => finish(() => reject(new Error(event.message || "Plan worker failed")));
        worker.onmessageerror = () => finish(() => reject(new Error("Plan worker returned an unreadable result")));
        signal.addEventListener("abort", onAbort, {once: true});
        worker.postMessage(request);
    });
}

export async function loadPlanInWorker(
    text: string,
    signal: AbortSignal,
    workerFactory: PlanWorkerFactory = createPlanWorker,
): Promise<LoadedPlan> {
    const response = await runPlanWorker({operation: "load", text}, signal, workerFactory);
    if (!response.ok) throw deserializeError(response.error);
    if (response.operation !== "load") throw new Error("Plan worker returned an unexpected validation result");
    const planDocument = response.plan.tree.textDocuments?.find(({id}) => id === planDocumentId);
    if (planDocument !== undefined) planDocument.text = new TextDecoder().decode(response.planText);
    return response.plan;
}

export async function validatePlanInWorker(text: string, signal: AbortSignal): Promise<string | undefined> {
    const response = await runPlanWorker({operation: "validate", text}, signal);
    return response.ok ? undefined : response.error.message;
}

function isXmlPlan(text: string): boolean {
    const planStart = text.search(/[<{[]/);
    return planStart >= 0 && text[planStart] === "<";
}

async function loadXmlPlan(text: string, signal: AbortSignal): Promise<LoadedPlan> {
    // DOMParser is not available in web workers. Keep the uncommon XML path
    // asynchronous at its boundary while JSON parsing stays entirely off-thread.
    const {loadPlanFromText} = await import(/* webpackChunkName: "xml-plan-loader" */ "@tableau/query-graphs/lib/loaders");
    // The import may already be cached, so yield a task explicitly to give React
    // and the browser an opportunity to paint before synchronous XML parsing.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (signal.aborted) throw abortError();
    return loadPlanFromText(text);
}

export function loadPlanDocument(text: string, signal: AbortSignal): Promise<LoadedPlan> {
    return isXmlPlan(text) ? loadXmlPlan(text, signal) : loadPlanInWorker(text, signal);
}

export async function validatePlanDocument(text: string, signal: AbortSignal): Promise<string | undefined> {
    if (!isXmlPlan(text)) return validatePlanInWorker(text, signal);
    try {
        await loadXmlPlan(text, signal);
        return undefined;
    } catch (error) {
        if (signal.aborted) throw error;
        return error instanceof Error ? error.message : "Unknown error";
    }
}

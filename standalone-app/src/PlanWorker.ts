import {loadPlanFromText} from "@tableau/query-graphs/lib/loaders";
import {planDocumentId, type PlanWorkerRequest, type PlanWorkerResponse, type SerializedPlanError} from "./PlanWorkerProtocol";

interface WorkerScope {
    onmessage: ((event: MessageEvent<PlanWorkerRequest>) => void) | null;
    postMessage(message: PlanWorkerResponse, transfer?: Transferable[]): void;
}

function serializeError(error: unknown): SerializedPlanError {
    if (error instanceof Error) {
        return {name: error.name, message: error.message, stack: error.stack};
    }
    return {name: "Error", message: String(error)};
}

const workerScope = globalThis as unknown as WorkerScope;
workerScope.onmessage = ({data}) => {
    try {
        const plan = loadPlanFromText(data.text);
        if (data.operation === "load") {
            const planDocument = plan.tree.textDocuments?.find(({id}) => id === planDocumentId);
            const planText = new TextEncoder().encode(planDocument?.text ?? "").buffer as ArrayBuffer;
            if (planDocument !== undefined) planDocument.text = "";
            const response: PlanWorkerResponse = {ok: true, operation: "load", plan, planText};
            workerScope.postMessage(response, [planText]);
            return;
        }
        workerScope.postMessage({ok: true, operation: "validate"});
    } catch (error) {
        workerScope.postMessage({ok: false, error: serializeError(error)});
    }
};

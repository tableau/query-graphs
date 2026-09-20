import type {LoadedPlan} from "@tableau/query-graphs/lib/loaders";

export const planDocumentId = "plan";

export interface PlanWorkerRequest {
    operation: "load" | "validate";
    text: string;
}

export interface SerializedPlanError {
    name: string;
    message: string;
    stack?: string;
}

export type PlanWorkerResponse =
    | {ok: true; operation: "load"; plan: LoadedPlan; planText: ArrayBuffer}
    | {ok: true; operation: "validate"}
    | {ok: false; error: SerializedPlanError};

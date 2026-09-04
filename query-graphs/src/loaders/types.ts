import type {TreeDescription} from "../tree-description";

export interface PlanLoader<Input> {
    readonly format: string;
    matches(input: Input): boolean;
    load(input: Input): TreeDescription;
}

export class InvalidPlanError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidPlanError";
    }
}

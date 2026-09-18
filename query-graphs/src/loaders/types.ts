import type {TreeDescription} from "../tree-description";

/** A format-specific renderer for input that has already been parsed as JSON or XML. */
export interface PlanLoader<Input> {
    readonly format: string;

    /**
     * Returns whether this loader is the preferred renderer for the input.
     * Recognition must never throw; returning false lets dispatch try the next loader.
     */
    matches(input: Input): boolean;

    /**
     * Renders the input as permissively as possible, including input for which `matches` returns false.
     * Throw `InvalidPlanError` only when producing a useful tree is impossible.
     */
    load(input: Input): TreeDescription;
}

export class InvalidPlanError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidPlanError";
    }
}

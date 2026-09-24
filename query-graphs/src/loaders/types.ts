import type {TreeDescription} from "../tree-description";
import type {SqlSourceLocator} from "./sql-source";

export interface PlanLoadContext {
    sqlSource?: SqlSourceLocator;
}

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
    load(input: Input, context?: PlanLoadContext): TreeDescription;
}

export class InvalidPlanError extends Error {
    readonly format: string | undefined;

    constructor(format?: string, options?: ErrorOptions) {
        super(format === undefined ? "Invalid query plan" : `Invalid ${format} query plan`, options);
        this.name = "InvalidPlanError";
        this.format = format;
    }
}

export class UnknownPlanFormatError extends Error {
    readonly format: string;
    readonly availableFormats: readonly string[];

    constructor(format: string, availableFormats: readonly string[]) {
        super(`Unknown query plan format '${format}'. Available formats: ${availableFormats.join(", ")}`);
        this.name = "UnknownPlanFormatError";
        this.format = format;
        this.availableFormats = availableFormats;
    }
}

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

export class PlanSyntaxError extends Error {
    readonly format: string | undefined;

    constructor(format: string | undefined, errors: unknown[]) {
        const context = format === undefined ? "query plan" : `${format} query plan`;
        super(`Cannot load ${context}: invalid syntax`, {
            cause: new AggregateError(errors.filter((error) => error !== undefined)),
        });
        this.name = "PlanSyntaxError";
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

export class InvalidPlanError extends Error {
    readonly format: string;

    constructor(format: string) {
        super(`Invalid ${format} query plan`);
        this.name = "InvalidPlanError";
        this.format = format;
    }
}

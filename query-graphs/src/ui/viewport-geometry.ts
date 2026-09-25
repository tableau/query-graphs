export interface ScreenRectangle {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export type RectangleDirection = "above" | "right" | "below" | "left";

export function intersectRectangles(left: ScreenRectangle, right: ScreenRectangle): ScreenRectangle | undefined {
    const intersection = {
        top: Math.max(left.top, right.top),
        right: Math.min(left.right, right.right),
        bottom: Math.min(left.bottom, right.bottom),
        left: Math.max(left.left, right.left),
    };
    return intersection.left < intersection.right && intersection.top < intersection.bottom ? intersection : undefined;
}

function subtractRectangle(source: ScreenRectangle, obstruction: ScreenRectangle): ScreenRectangle[] {
    const overlap = intersectRectangles(source, obstruction);
    if (overlap === undefined) return [source];
    return [
        {top: source.top, right: source.right, bottom: overlap.top, left: source.left},
        {top: overlap.bottom, right: source.right, bottom: source.bottom, left: source.left},
        {top: overlap.top, right: overlap.left, bottom: overlap.bottom, left: source.left},
        {top: overlap.top, right: source.right, bottom: overlap.bottom, left: overlap.right},
    ].filter((rectangle) => rectangle.left < rectangle.right && rectangle.top < rectangle.bottom);
}

function rectangleArea(rectangle: ScreenRectangle): number {
    return Math.max(0, rectangle.right - rectangle.left) * Math.max(0, rectangle.bottom - rectangle.top);
}

/** Returns the fraction of `rectangle` visible inside the viewport after subtracting every obstruction. */
export function visibleRectangleFraction(
    rectangle: ScreenRectangle,
    viewport: ScreenRectangle,
    obstructions: readonly ScreenRectangle[],
): number {
    const rectangleSize = rectangleArea(rectangle);
    const clipped = intersectRectangles(rectangle, viewport);
    if (rectangleSize === 0 || clipped === undefined) return 0;
    let visiblePieces = [clipped];
    for (const obstruction of obstructions) visiblePieces = visiblePieces.flatMap((piece) => subtractRectangle(piece, obstruction));
    return visiblePieces.reduce((area, piece) => area + rectangleArea(piece), 0) / rectangleSize;
}

/** Returns the dominant normalized direction in which `rectangle` extends beyond `viewport`. */
export function primaryDirectionOutsideRectangle(rectangle: ScreenRectangle, viewport: ScreenRectangle): RectangleDirection {
    const viewportWidth = Math.max(1, viewport.right - viewport.left);
    const viewportHeight = Math.max(1, viewport.bottom - viewport.top);
    const scores: Record<RectangleDirection, number> = {
        above: Math.max(0, viewport.top - rectangle.top) / viewportHeight,
        right: Math.max(0, rectangle.right - viewport.right) / viewportWidth,
        below: Math.max(0, rectangle.bottom - viewport.bottom) / viewportHeight,
        left: Math.max(0, viewport.left - rectangle.left) / viewportWidth,
    };
    return (Object.entries(scores) as [RectangleDirection, number][]).reduce((primary, candidate) =>
        candidate[1] > primary[1] ? candidate : primary,
    )[0];
}

/** Trims a viewport around obstructions attached to either horizontal edge. */
export function viewportBetweenSideObstructions(
    viewport: ScreenRectangle,
    obstructions: readonly ScreenRectangle[],
): ScreenRectangle | undefined {
    let left = viewport.left;
    let right = viewport.right;
    for (const obstruction of obstructions) {
        const coveredArea = intersectRectangles(viewport, obstruction);
        if (coveredArea === undefined) continue;
        if (coveredArea.left - viewport.left <= viewport.right - coveredArea.right) left = Math.max(left, coveredArea.right);
        else right = Math.min(right, coveredArea.left);
    }
    return left < right ? {...viewport, left, right} : undefined;
}

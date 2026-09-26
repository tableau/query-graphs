export interface ScreenRectangle {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

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

/** Reserves horizontal space for panels overlapping the nearest side of a viewport. */
export function horizontalViewportInsets(
    viewport: ScreenRectangle,
    obstructions: readonly ScreenRectangle[],
    margin: number,
): {left: number; right: number} | undefined {
    let left = margin;
    let right = margin;
    for (const obstruction of obstructions) {
        const coveredArea = intersectRectangles(viewport, obstruction);
        if (coveredArea === undefined) continue;
        if (coveredArea.left - viewport.left <= viewport.right - coveredArea.right)
            left = Math.max(left, coveredArea.right - viewport.left + margin);
        else right = Math.max(right, viewport.right - coveredArea.left + margin);
    }
    return left + right < viewport.right - viewport.left ? {left, right} : undefined;
}

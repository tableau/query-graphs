// `reactflow`'s type declarations reference the global `JSX` namespace, which
// `@types/react` 19 no longer declares (it moved to `React.JSX`).
// See https://react.dev/blog/2024/04/25/react-19-upgrade-guide#the-jsx-namespace-in-typescript
// Shared (not package-local) because both query-graphs and standalone-app type-check
// against reactflow's declarations, directly or via query-graphs's lib/ui/*.d.ts.
/* eslint-disable @typescript-eslint/no-empty-object-type */
export {};

declare global {
    namespace JSX {
        type ElementType = React.JSX.ElementType;
        interface Element extends React.JSX.Element {}
        interface ElementClass extends React.JSX.ElementClass {}
        interface ElementAttributesProperty extends React.JSX.ElementAttributesProperty {}
        interface ElementChildrenAttribute extends React.JSX.ElementChildrenAttribute {}
        interface IntrinsicAttributes extends React.JSX.IntrinsicAttributes {}
        interface IntrinsicClassAttributes<T> extends React.JSX.IntrinsicClassAttributes<T> {}
        interface IntrinsicElements extends React.JSX.IntrinsicElements {}
    }
}

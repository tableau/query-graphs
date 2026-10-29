import {useEffect, useMemo, useRef, useState, type KeyboardEvent} from "react";
import cc from "classcat";
import type {CategoricalInsightCategory} from "../insights/categorical";
import {ChevronIcon} from "./ChevronIcon";
import {useGraphRenderingStore} from "./store";
import "./CategoryTree.css";

interface CategoryTreeCategory {
    value: string;
    nodeIds: ReadonlySet<string>;
    children: readonly CategoryTreeCategory[];
}

interface CategoryTreeInteraction {
    hovered?: CategoryTreeCategory;
    focused?: CategoryTreeCategory;
    tabStop?: CategoryTreeCategory;
    expandedCategories: ReadonlySet<CategoryTreeCategory>;
    onHover: (category?: CategoryTreeCategory) => void;
    onFocus: (category?: CategoryTreeCategory) => void;
    onToggle: (category: CategoryTreeCategory) => void;
    onTypeAhead: (key: string, current: HTMLElement) => void;
}

function sameIds(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
    return left.size === right.size && [...left].every((id) => right.has(id));
}

function visibleRows(current: HTMLElement): HTMLElement[] {
    const tree = current.closest('[role="tree"]');
    return tree ? [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')] : [];
}

function CategoryTreeElement({
    category,
    interaction,
    initialTabStop = false,
}: {
    category: CategoryTreeCategory;
    interaction: CategoryTreeInteraction;
    initialTabStop?: boolean;
}) {
    const {value, nodeIds, children} = category;
    const highlightedNodeIds = useGraphRenderingStore((state) => state.highlightedNodeIds);
    const open = interaction.expandedCategories.has(category);
    const toggle = () => interaction.onToggle(category);
    // A category covers all nodes in its descendant categories. Highlight only the
    // deepest displayed match when a graph node or source range drives the highlight.
    const selectedCategory =
        interaction.hovered ??
        (interaction.focused && sameIds(interaction.focused.nodeIds, highlightedNodeIds) ? interaction.focused : undefined);
    const active = selectedCategory
        ? selectedCategory === category
        : (!open || children.length === 0) && [...nodeIds].some((id) => highlightedNodeIds.has(id));
    // Arrows, Home, End, and type-ahead navigate visible rows. Space toggles expansion;
    // Enter remains free for future row actions such as scrolling to a graph node.
    const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
        if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
        const current = event.currentTarget;
        const rows = visibleRows(current);
        const index = rows.indexOf(current);
        let next: HTMLElement | undefined;
        switch (event.key) {
            case "ArrowDown":
                next = rows[index + 1];
                break;
            case "ArrowUp":
                next = rows[index - 1];
                break;
            case "Home":
                next = rows[0];
                break;
            case "End":
                next = rows[rows.length - 1];
                break;
            case "ArrowRight":
                if (children.length && !open) toggle();
                else if (open)
                    next = current.querySelector<HTMLElement>(':scope > [role="group"] > [role="treeitem"]') ?? undefined;
                break;
            case "ArrowLeft":
                if (open) toggle();
                else next = current.parentElement?.closest<HTMLElement>('[role="treeitem"]') ?? undefined;
                break;
            case " ":
                if (children.length) toggle();
                break;
            case "Enter":
                // Reserved for future row actions.
                break;
            default:
                if (event.key.length !== 1) return;
                interaction.onTypeAhead(event.key, current);
                event.preventDefault();
                return;
        }
        event.preventDefault();
        next?.focus();
    };

    // The treeitem exposes the row's label, count, and expansion state to assistive technology.
    // Clicking a row follows the same expansion path as Space.
    return (
        <li
            role="treeitem"
            tabIndex={interaction.tabStop === category || (initialTabStop && !interaction.tabStop) ? 0 : -1}
            aria-label={`${value}: ${nodeIds.size}`}
            aria-expanded={children.length ? open : undefined}
            data-label={value}
            onKeyDown={onKeyDown}
            onFocus={(event) => {
                if (event.target === event.currentTarget) interaction.onFocus(category);
            }}
            onBlur={(event) => {
                if (event.target === event.currentTarget) interaction.onFocus(undefined);
            }}
        >
            <div
                className={cc(["qg-category-tree-category", {"qg-category-tree-category-active": active}])}
                onMouseEnter={() => interaction.onHover(category)}
                onMouseLeave={() => interaction.onHover(undefined)}
                onClick={(event) => {
                    const selection = event.currentTarget.ownerDocument.getSelection();
                    if (selection && !selection.isCollapsed && event.currentTarget.contains(selection.anchorNode)) return;
                    event.currentTarget.parentElement?.focus();
                    if (children.length) toggle();
                }}
            >
                <span className="qg-category-tree-disclosure">{children.length > 0 ? <ChevronIcon expanded={open} /> : null}</span>
                <span className="qg-category-tree-category-label" title={value}>
                    {value}
                </span>
                <span className="qg-category-tree-category-count">{nodeIds.size}</span>
            </div>
            {children.length > 0 ? (
                <ul role="group" hidden={!open}>
                    {open
                        ? children.map((child) => (
                              <CategoryTreeElement key={child.value} category={child} interaction={interaction} />
                          ))
                        : null}
                </ul>
            ) : null}
        </li>
    );
}

export function CategoryTree({
    categories: inputCategories,
    title,
}: {
    categories: readonly CategoricalInsightCategory[];
    title: string;
}) {
    const getNodeId = useGraphRenderingStore((state) => state.getNodeId);
    const categories = useMemo(() => {
        const convert = ({value, nodes, children}: CategoricalInsightCategory): CategoryTreeCategory => ({
            value,
            nodeIds: new Set(
                nodes.flatMap((node) => {
                    const id = getNodeId(node);
                    return id === undefined ? [] : [id];
                }),
            ),
            children: children.map(convert),
        });
        return inputCategories.map(convert);
    }, [getNodeId, inputCategories]);
    // Start with only the first category level visible.
    // Keep descendant categories when a parent closes so reopening restores their expansion.
    // This tree stays mounted while its insight section is closed for the same reason.
    const [expandedCategories, setExpandedCategories] = useState<ReadonlySet<CategoryTreeCategory>>(() => new Set());
    const [hovered, setHovered] = useState<CategoryTreeCategory>();
    const [focused, setFocused] = useState<CategoryTreeCategory>();
    // One tab stop per tree; Tab returns to the last focused row.
    const [tabStop, setTabStop] = useState<CategoryTreeCategory>();
    const typeAhead = useRef({prefix: "", time: 0});
    const setHoveredNodeIds = useGraphRenderingStore((state) => state.setHoveredNodeIds);
    const setFocusedNodeIds = useGraphRenderingStore((state) => state.setFocusedNodeIds);
    const previousCategories = useRef(categories);
    useEffect(() => {
        if (previousCategories.current === categories) return;
        previousCategories.current = categories;
        setExpandedCategories(new Set());
        setHovered(undefined);
        setFocused(undefined);
        setTabStop(undefined);
        typeAhead.current = {prefix: "", time: 0};
    }, [categories]);
    const interaction: CategoryTreeInteraction = {
        hovered,
        focused,
        tabStop,
        expandedCategories,
        onHover(category) {
            setHovered(category);
            setHoveredNodeIds(category?.nodeIds);
        },
        onFocus(category) {
            setFocused(category);
            if (category) setTabStop(category);
            setFocusedNodeIds(category?.nodeIds);
        },
        onToggle(category) {
            setExpandedCategories((previous) => {
                const next = new Set(previous);
                if (next.has(category)) next.delete(category);
                else next.add(category);
                return next;
            });
        },
        onTypeAhead(key, current) {
            const now = Date.now();
            const previous = typeAhead.current;
            const prefix = now - previous.time < 700 ? previous.prefix + key.toLocaleLowerCase() : key.toLocaleLowerCase();
            typeAhead.current = {prefix, time: now};
            const rows = visibleRows(current);
            const index = rows.indexOf(current);
            // Keep the current row when its label matches, including on the first keystroke.
            const candidates = [...rows.slice(index), ...rows.slice(0, index)];
            const next = candidates.find((row) => row.dataset.label?.toLocaleLowerCase().startsWith(prefix));
            if (next !== current) next?.focus();
        },
    };
    return (
        <ul role="tree" aria-label={title} className="qg-category-tree">
            {categories.map((category, index) => (
                <CategoryTreeElement
                    key={category.value}
                    category={category}
                    interaction={interaction}
                    initialTabStop={index === 0}
                />
            ))}
        </ul>
    );
}

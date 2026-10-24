import {useId, useMemo, useRef, useState, type KeyboardEvent} from "react";
import type {TreeNode} from "../tree-description";
import type {CategoricalInsightCategory, CategoricalInsightDefinition} from "../insights/categorical";
import {computeCategoricalInsight} from "../insights/categorical";
import {CollapsiblePanel} from "./CollapsiblePanel";
import {ScrollableArea} from "./ScrollableArea";
import {useGraphRenderingStore} from "./store";
import "./CategoryTree.css";

interface CategoricalInsightPanelProps {
    root: TreeNode;
    definitions: readonly CategoricalInsightDefinition[];
    title: string;
}

interface CategoryTreeCategory {
    value: string;
    nodeIds: ReadonlySet<string>;
    children: readonly CategoryTreeCategory[];
}

interface CategoryTreeInteraction {
    hovered?: CategoryTreeCategory;
    focused?: CategoryTreeCategory;
    tabStop?: CategoryTreeCategory;
    expandedPaths: ReadonlySet<string>;
    onHover: (category?: CategoryTreeCategory) => void;
    onFocus: (category?: CategoryTreeCategory) => void;
    onToggle: (path: string) => void;
    onTypeAhead: (key: string, current: HTMLElement) => void;
}

function sameIds(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
    return left.size === right.size && [...left].every((id) => right.has(id));
}

function visibleRows(current: HTMLElement): HTMLElement[] {
    const tree = current.closest('[role="tree"]');
    return tree ? [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')] : [];
}

function CategoryRow({
    category,
    interaction,
    path,
    initialTabStop = false,
}: {
    category: CategoryTreeCategory;
    interaction: CategoryTreeInteraction;
    path: readonly string[];
    initialTabStop?: boolean;
}) {
    const {value, nodeIds, children} = category;
    const highlightedNodeIds = useGraphRenderingStore((state) => state.highlightedNodeIds);
    const pathKey = JSON.stringify(path);
    const open = interaction.expandedPaths.has(pathKey);
    const toggle = () => interaction.onToggle(pathKey);
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
                className={`qg-category-tree-category${active ? " qg-category-tree-category-active" : ""}`}
                onMouseEnter={() => interaction.onHover(category)}
                onMouseLeave={() => interaction.onHover(undefined)}
                onClick={(event) => {
                    const selection = event.currentTarget.ownerDocument.getSelection();
                    if (selection && !selection.isCollapsed && event.currentTarget.contains(selection.anchorNode)) return;
                    event.currentTarget.parentElement?.focus();
                    if (children.length) toggle();
                }}
            >
                {children.length > 0 ? (
                    <span className="qg-category-tree-disclosure" aria-hidden="true" data-expanded={open ? "" : undefined}>
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                            <path d="M5.5 3.5 10.5 8l-5 4.5" />
                        </svg>
                    </span>
                ) : (
                    <span className="qg-category-tree-disclosure-spacer" />
                )}
                <span className="qg-category-tree-category-label" title={value}>
                    {value}
                </span>
                <span className="qg-category-tree-category-count">{nodeIds.size}</span>
            </div>
            {children.length > 0 ? (
                <ul role="group" hidden={!open}>
                    {open
                        ? children.map((child) => (
                              <CategoryRow
                                  key={child.value}
                                  category={child}
                                  interaction={interaction}
                                  path={[...path, child.value]}
                              />
                          ))
                        : null}
                </ul>
            ) : null}
        </li>
    );
}

interface InsightSectionData {
    definition: CategoricalInsightDefinition;
    categories: readonly CategoryTreeCategory[];
}

function CategoryTree({categories, title}: {categories: readonly CategoryTreeCategory[]; title: string}) {
    // Start with only the first category level visible.
    // Keep descendant paths when a parent closes so reopening restores their expansion.
    // This tree stays mounted while its insight section is closed for the same reason.
    const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(() => new Set());
    const [hovered, setHovered] = useState<CategoryTreeCategory>();
    const [focused, setFocused] = useState<CategoryTreeCategory>();
    // One tab stop per tree; Tab returns to the last focused row.
    const [tabStop, setTabStop] = useState<CategoryTreeCategory>();
    const typeAhead = useRef({prefix: "", time: 0});
    const setHoveredNodeIds = useGraphRenderingStore((state) => state.setHoveredNodeIds);
    const setFocusedNodeIds = useGraphRenderingStore((state) => state.setFocusedNodeIds);
    const interaction: CategoryTreeInteraction = {
        hovered,
        focused,
        tabStop,
        expandedPaths,
        onHover(category) {
            setHovered(category);
            setHoveredNodeIds(category?.nodeIds);
        },
        onFocus(category) {
            setFocused(category);
            if (category) setTabStop(category);
            setFocusedNodeIds(category?.nodeIds);
        },
        onToggle(path) {
            setExpandedPaths((previous) => {
                const next = new Set(previous);
                if (next.has(path)) next.delete(path);
                else next.add(path);
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
            const candidates = [...rows.slice(index + 1), ...rows.slice(0, index + 1)];
            let next = candidates.find((row) => row.dataset.label?.toLocaleLowerCase().startsWith(prefix));
            if (!next && prefix.length > 1 && [...prefix].every((character) => character === key.toLocaleLowerCase())) {
                typeAhead.current.prefix = key.toLocaleLowerCase();
                next = candidates.find((row) => row.dataset.label?.toLocaleLowerCase().startsWith(typeAhead.current.prefix));
            }
            next?.focus();
        },
    };
    return (
        <ul role="tree" aria-label={title}>
            {categories.map((category, index) => (
                <CategoryRow
                    key={category.value}
                    category={category}
                    interaction={interaction}
                    path={[category.value]}
                    initialTabStop={index === 0}
                />
            ))}
        </ul>
    );
}

function InsightSection({definition, categories, highlighted}: InsightSectionData & {highlighted: boolean}) {
    // Section headers are outside their trees; only category rows participate in tree navigation.
    // Sections start open and collapse independently without unmounting their trees.
    const [open, setOpen] = useState(true);
    const contentId = useId();
    const count = categories.reduce((sum, category) => sum + category.nodeIds.size, 0);
    return (
        <section className="qg-category-tree-insight" aria-label={definition.title}>
            <h3>
                <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={contentId}
                    className={!open && highlighted ? "qg-category-tree-section-highlighted" : undefined}
                    onClick={() => setOpen(!open)}
                >
                    <svg viewBox="0 0 16 16" aria-hidden="true" className={open ? "qg-category-tree-section-open" : ""}>
                        <path d="M5.5 3.5 10.5 8l-5 4.5" />
                    </svg>
                    <span>{definition.title}</span>
                    <span className="qg-category-tree-section-count">{count}</span>
                </button>
            </h3>
            <div id={contentId} hidden={!open} className="qg-category-tree-category-list">
                <CategoryTree categories={categories} title={definition.title} />
            </div>
        </section>
    );
}

export function CategoricalInsightPanel({root, definitions, title}: CategoricalInsightPanelProps) {
    const getNodeId = useGraphRenderingStore((state) => state.getNodeId);
    const highlightedNodeIds = useGraphRenderingStore((state) => state.highlightedNodeIds);
    const [open, setOpen] = useState(false);
    const sections = useMemo(() => {
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
        return definitions.flatMap((definition) => {
            const categories = computeCategoricalInsight(root, definition).map(convert);
            return categories.length ? [{definition, categories}] : [];
        });
    }, [definitions, getNodeId, root]);
    if (sections.length === 0) return null;

    const active = sections.some(({categories}) =>
        categories.some(({nodeIds}) => [...nodeIds].some((id) => highlightedNodeIds.has(id))),
    );
    return (
        <CollapsiblePanel
            title={title}
            className="qg-insights-panel"
            containsHighlightedContent={active}
            open={open}
            onOpenChange={setOpen}
        >
            <ScrollableArea>
                {sections.map(({definition, categories}) => (
                    <InsightSection
                        key={definition.id}
                        definition={definition}
                        categories={categories}
                        highlighted={categories.some(({nodeIds}) => [...nodeIds].some((id) => highlightedNodeIds.has(id)))}
                    />
                ))}
            </ScrollableArea>
        </CollapsiblePanel>
    );
}

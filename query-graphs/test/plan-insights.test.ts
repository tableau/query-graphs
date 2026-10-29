import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import type {TreeNode} from "../src/tree-description";
import {insightPresets} from "../src/insights/presets";
import {createUiFixture, testGraphStore} from "./ui-test-utils";

test("plan insights render ordered, independent sections with counts", async () => {
    const {PlanInsights} = await import("../src/ui/PlanInsights");
    const scan: TreeNode = {
        properties: new Map([
            ["operator", "scan"],
            ["type", "native"],
            ["table-name", "orders"],
        ]),
    };
    const reference: TreeNode = {properties: new Map([["expression", "reference"]])};
    const root: TreeNode = {children: [scan, reference]};
    const fixture = createUiFixture(testGraphStore([root, scan, reference]));
    try {
        await fixture.render(React.createElement(PlanInsights, {root, definitions: insightPresets.hyper}));
        const panel = fixture.document.querySelector<HTMLElement>(".qg-collapsible-panel")!;
        const panelToggle = panel.querySelector<HTMLButtonElement>(".qg-collapsible-panel-toggle")!;
        // The shared panel begins closed, while its three nonempty insights retain preset order.
        assert.equal(panelToggle.ariaExpanded, "false");
        await React.act(async () => panelToggle.click());
        const sections = [...panel.querySelectorAll<HTMLElement>(".qg-plan-insight")];
        assert.deepEqual(
            sections.map((section) => section.querySelector(".qg-plan-insight-title")?.textContent),
            ["Scanned Tables", "Operators", "Expressions"],
        );
        assert.deepEqual(
            sections.map((section) => section.querySelector(".qg-plan-insight-count")?.textContent),
            ["1", "1", "1"],
        );
        // Each insight has its own accessible tree; the insight title is not an extra tree row.
        assert.deepEqual(
            [...panel.querySelectorAll<HTMLElement>('[role="tree"]')].map((tree) => tree.getAttribute("aria-label")),
            ["Scanned Tables", "Operators", "Expressions"],
        );
        assert.deepEqual(
            [...sections[1].querySelectorAll<HTMLElement>('[role="treeitem"]')].map((row) => row.dataset.label),
            ["scan"],
        );
        const scanRow = sections[1].querySelector<HTMLElement>('[role="treeitem"]')!;
        // Closing a section keeps its tree mounted and preserves nested expansion choices.
        await fixture.key(scanRow, "ArrowRight");
        const nativeRow = sections[1].querySelectorAll<HTMLElement>('[role="treeitem"]')[1];
        await fixture.key(nativeRow, "ArrowRight");
        const operatorToggle = sections[1].querySelector<HTMLButtonElement>("h3 button")!;
        await React.act(async () => operatorToggle.click());
        await React.act(async () => operatorToggle.click());
        assert.deepEqual(
            [...sections[1].querySelectorAll<HTMLElement>('[role="treeitem"]')].map((row) => row.dataset.label),
            ["scan", "native", "orders"],
        );
        const expressionToggle = sections[2].querySelector<HTMLButtonElement>("h3 button")!;
        // Sections disclose independently, so hiding expressions leaves operators visible.
        await React.act(async () => expressionToggle.click());
        assert.equal(expressionToggle.ariaExpanded, "false");
        assert.equal(sections[2].querySelector<HTMLElement>(".qg-plan-insight-content")?.hidden, true);
        assert.equal(sections[1].querySelector<HTMLElement>(".qg-plan-insight-content")?.hidden, false);
        await React.act(async () => expressionToggle.click());
        assert.equal(sections[2].querySelector<HTMLElement>(".qg-plan-insight-content")?.hidden, false);
    } finally {
        await fixture.cleanup();
    }
});

test("plan insights omit empty sections and the panel when nothing matches", async () => {
    const {PlanInsights} = await import("../src/ui/PlanInsights");
    const root: TreeNode = {properties: new Map([["operator", "scan"]])};
    const fixture = createUiFixture(testGraphStore([root]));
    try {
        await fixture.render(React.createElement(PlanInsights, {root, definitions: insightPresets.hyper}));
        // An absent expression category omits only that section.
        assert.deepEqual(
            [...fixture.document.querySelectorAll(".qg-plan-insight-title")].map((element) => element.textContent),
            ["Scanned Tables", "Operators"],
        );
        await fixture.render(React.createElement(PlanInsights, {root: {}, definitions: insightPresets.hyper}));
        // With no matching categories there is no empty Plan Insights panel.
        assert.equal(fixture.document.querySelector(".qg-collapsible-panel"), null);
    } finally {
        await fixture.cleanup();
    }
});

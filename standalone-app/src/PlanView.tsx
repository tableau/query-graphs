import {useId} from "react";
import type {LoadedPlan} from "@tableau/query-graphs/lib/loaders";
import {insightPresets} from "@tableau/query-graphs/lib/insights/presets";
import {GraphToolbar, QueryGraph} from "@tableau/query-graphs/lib/ui/QueryGraph";
import {TreeLabel} from "./TreeLabel";
import {SettingsButton, SettingsPanel} from "./SettingsPanel";
import {useSettings} from "./settings";
import {useTheme} from "./theme";

export interface PlanViewProps {
    loadedPlan: LoadedPlan;
    title: string;
    setTitle?: (value: string) => void;
}

export function PlanView({loadedPlan, title, setTitle}: PlanViewProps) {
    const settingsPopoverId = useId();
    const animationSpeed = useSettings((settings) => settings.values.animationSpeed);
    const theme = useTheme();
    const {tree, format} = loadedPlan;

    return (
        <QueryGraph treeDescription={tree} animationSpeed={animationSpeed} theme={theme}>
            <TreeLabel
                title={title}
                setTitle={setTitle}
                metadata={tree.metadata}
                metadataHighlighted={tree.metadataHighlighted}
                textDocuments={tree.textDocuments}
                insights={insightPresets[format] ? {root: tree.root, definitions: insightPresets[format]} : undefined}
            />
            <SettingsPanel popoverId={settingsPopoverId} />
            <GraphToolbar>
                <SettingsButton popoverId={settingsPopoverId} />
            </GraphToolbar>
        </QueryGraph>
    );
}

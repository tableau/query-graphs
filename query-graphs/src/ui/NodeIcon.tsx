import {CSSProperties, SVGAttributes} from "react";
import {IconName} from "../tree-description";
import "./NodeIcon.css";

interface NodeIconProps {
    icon?: IconName;
    iconColor?: string;
    style?: CSSProperties;
}

function sharedSvgProps({style, iconColor}: NodeIconProps): SVGAttributes<SVGSVGElement> {
    return {
        className: "qg-icon",
        style: {
            color: iconColor,
            ...style,
        },
    };
}

function DefaultIcon(p: NodeIconProps) {
    return (
        <svg viewBox="-7 -7 14 14" {...sharedSvgProps(p)}>
            <circle r="5" fill="currentColor" />
        </svg>
    );
}

function RunQueryIcon(p: NodeIconProps) {
    return (
        <svg viewBox="-7 -7 14 14" {...sharedSvgProps(p)}>
            <circle r="6" fill="currentColor" />
            <path d="M-2.5,-3.5L4,0L-2.5,3.5 z" fill="#fff" />
        </svg>
    );
}

function GroupByIcon(p: NodeIconProps) {
    return (
        <svg viewBox="0 0 14 14" {...sharedSvgProps(p)}>
            <path
                d="m 12.791493,0.09859908 0.07435,3.95594402 h -0.397475 c -0.02719,-0.65226 -0.166472,-1.17541 -0.417854,-1.5695 -0.251404,-0.3940699 -0.55885,-0.6437599 -0.92234,-0.7490799 -0.363511,-0.10524 -0.888379,-0.15806 -1.5746055,-0.15806 H 5.6807598 l -0.023394,9.8231058 c -4.8e-6,0.91046 0.1171977,1.48798 0.3516101,1.73259 0.2344018,0.24459 0.7762555,0.38048 1.6255615,0.40765 v 0.3771 H 1.7030209 v -0.3771 c 0.8560938,-0.0272 1.4030432,-0.16306 1.6408499,-0.40765 0.2378018,-0.24461 0.3567027,-0.82213 0.3567059,-1.73259 v -8.78515 c -3.2e-6,-0.91044 -0.1189041,-1.4879799 -0.3567059,-1.73258992 -0.2378067,-0.24457 -0.7847561,-0.38046 -1.6408499,-0.40765 v -0.3771 z"
                fill="currentColor"
                stroke="inherit"
            />
        </svg>
    );
}

function SortIcon(p: NodeIconProps) {
    return (
        <svg viewBox="-9 -8 18 18" {...sharedSvgProps(p)}>
            <rect x={-8} y={-8} width={16} height="16" fill="#fff" stroke="none"></rect>
            <path d="M6,3 L6,6 L-7,6 L-7,3 Z" fill="currentColor" />
            <path d="M0,-2 L0,1 L-7,1 L-7,-2 Z" fill="currentColor" />
            <path d="M-3,-7 L-3,-4 L-7,-4 L-7,-7 Z" fill="currentColor" />
            <path d="M6,-7 L6,-2 L8,-2 L5.7,0.77 L5.3,0.77 L3,-2 L5,-2 L5,-7 Z" fill="currentColor" />
        </svg>
    );
}

function FilterIcon(p: NodeIconProps) {
    return (
        <svg viewBox="-7 -7 14 14" {...sharedSvgProps(p)}>
            <path d="M-6,-6 L6,-6 L0.8,0 L0.8,5 L-0.8,7 L-0.8,0 Z" fill="currentColor" />
        </svg>
    );
}

interface JoinFills {
    left: boolean;
    center: boolean;
    right: boolean;
}

function createJoinIcon(joinFills: JoinFills) {
    return function JoinIcon(p: NodeIconProps) {
        // Join symbols are just 2 overlapped circles for the most part.
        const radius = 6.0;
        const leftOffset = -3.0;
        const rightOffset = 3.0;

        return (
            <svg viewBox="-10 -7 20 14" {...sharedSvgProps(p)}>
                {/* left and right circle */}
                <circle r={radius} cx={leftOffset} stroke="none" fill={joinFills.left ? "currentColor" : "#fff"} />
                <circle r={radius} cx={rightOffset} stroke="none" fill={joinFills.right ? "currentColor" : "#fff"} />
                {/* intersection of both circles */}
                <clipPath id="join-clip">
                    <circle r={radius} cx={leftOffset} />
                </clipPath>
                <circle
                    r={radius}
                    cx={rightOffset}
                    clipPath="url(#join-clip)"
                    stroke="none"
                    fill={joinFills.center ? "currentColor" : "#fff"}
                />
                {/* the borders */}
                <circle r={radius} cx={leftOffset} fill="none" />
                <circle r={radius} cx={rightOffset} fill="none" />
            </svg>
        );
    };
}

const InnerJoinIcon = createJoinIcon({left: false, center: true, right: false});
const LeftJoinIcon = createJoinIcon({left: true, center: true, right: false});
const RightJoinIcon = createJoinIcon({left: false, center: true, right: true});
const FullJoinIcon = createJoinIcon({left: true, right: true, center: true});

function createTableIcon(labelText?: string) {
    return function TableIcon(p: NodeIconProps) {
        const tableRowWidth = 5.2;
        const tableRowHeight = 2.8;
        const tableWidth = tableRowWidth * 3;
        const tableHeight = tableRowHeight * 4;
        const tableStartLeft = -tableWidth / 2;
        const tableStartTop = -tableHeight / 2;

        let content;
        if (labelText) {
            content = (
                <text className="qg-table-text" y={tableRowHeight + 0.8 /* stroke-width */ / 2}>
                    {labelText}
                </text>
            );
        } else {
            content = (
                <>
                    <rect
                        className="qg-table-border"
                        x={tableStartLeft}
                        width={tableWidth}
                        y={0}
                        height={tableRowHeight}
                        fill="none"
                    />
                    <rect
                        className="qg-table-border"
                        x={-tableRowWidth / 2}
                        width={tableRowWidth}
                        y={tableStartTop + tableRowHeight}
                        height={tableHeight - tableRowHeight}
                        fill="none"
                    />
                </>
            );
        }

        return (
            <svg viewBox="-10 -7 20 14" {...sharedSvgProps(p)}>
                <rect x={tableStartLeft} width={tableWidth} y={tableStartTop} height={tableHeight} fill="#fff" />
                <rect x={tableStartLeft} width={tableWidth} y={tableStartTop} height={tableRowHeight} fill="currentColor" />
                {content}
            </svg>
        );
    };
}

const TableIcon = createTableIcon();
const ConstTableIcon = createTableIcon("cnst");
const VirtualTableIcon = createTableIcon("dmv");
const TempTableIcon = createTableIcon("tmp");

export function NodeIcon({icon, ...rest}: NodeIconProps) {
    const iconTypes: Record<IconName, any> = {
        "run-query-symbol": RunQueryIcon,
        "filter-symbol": FilterIcon,
        "groupby-symbol": GroupByIcon,
        "sort-symbol": SortIcon,
        "inner-join-symbol": InnerJoinIcon,
        "left-join-symbol": LeftJoinIcon,
        "right-join-symbol": RightJoinIcon,
        "full-join-symbol": FullJoinIcon,
        "table-symbol": TableIcon,
        "temp-table-symbol": TempTableIcon,
        "virtual-table-symbol": VirtualTableIcon,
        "const-table-symbol": ConstTableIcon,
    };
    const SelectedIcon = icon ? iconTypes[icon] : DefaultIcon;
    return <SelectedIcon {...rest} />;
}

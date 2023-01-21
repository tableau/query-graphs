import { CSSProperties } from "react";
import "./NodeIcon.css"

interface NodeIconProps {
    icon?: string;
    style?: CSSProperties;
}

function DefaultIcon({ style }: NodeIconProps) {
    return (
        <svg style={style} viewBox="-7 -7 14 14" className="qg-icon qg-expanded">
            <circle r="5" fill="currentColor" />
        </svg>
    );
}

function RunQueryIcon({ style }: NodeIconProps) {
    return (
        <svg style={style} viewBox="-7 -7 14 14" className="qg-icon qg-expanded">
            <circle r="6" fill="currentColor" />
            <path d="M-2.5,-3.5L4,0L-2.5,3.5 z" fill="#fff" />
        </svg>
    );
}

function SortIcon({ style }: NodeIconProps) {
    return (
        <svg style={style} viewBox="-9 -9 18 18" className="qg-icon qg-expanded">
            <rect x={-8} y={-8} width={16} height="16" fill="#fff" stroke="none"></rect>
            <path d="M6,3 L6,6 L-7,6 L-7,3 Z" fill="currentColor"/>
            <path d="M0,-2 L0,1 L-7,1 L-7,-2 Z" fill="currentColor"/>
            <path d="M-3,-7 L-3,-4 L-7,-4 L-7,-7 Z" fill="currentColor"/>
            <path d="M6,-7 L6,-2 L8,-2 L5.7,0.77 L5.3,0.77 L3,-2 L5,-2 L5,-7 Z" fill="currentColor"/>
        </svg>
    );
}

function FilterIcon({ style }: NodeIconProps) {
    return (
        <svg style={style} viewBox="-7 -7 14 14" className="qg-icon qg-expanded">
            <path d="M-6,-6 L6,-6 L0.8,0 L0.8,5 L-0.8,7 L-0.8,0 Z" fill="currentColor" />
        </svg>
    );
}

interface JoinFills {
    left: boolean;
    center: boolean;
    right: boolean;
}

function createJoinIcon(joinFills : JoinFills) {
    return function JoinIcon({ style }: NodeIconProps) {
        // Join symbols are just 2 overlapped circles for the most part.
        const radius = 6.0;
        const leftOffset = -3.0;
        const rightOffset = 3.0;

        return (
            <svg style={style} viewBox="-10 -7 20 14" className="qg-icon qg-expanded">
                {/* left and right circle */}
                <circle r={radius} cx={leftOffset} stroke="none" fill={joinFills.left ? "currentColor" : "#fff"}/>
                <circle r={radius} cx={rightOffset} stroke="none" fill={joinFills.right ? "currentColor" : "#fff"}/>
                {/* intersection of both circles */}
                <clipPath id="join-clip">
                    <circle r={radius} cx={leftOffset}/>
                </clipPath>
                <circle r={radius} cx={rightOffset} clipPath="url(#join-clip)" stroke="none" fill={joinFills.center ? "currentColor" : "#fff"}/>
                {/* the borders */}
                <circle r={radius} cx={leftOffset} fill="none"/>
                <circle r={radius} cx={rightOffset} fill="none"/>
            </svg>
        );
    }
}

const InnerJoinIcon = createJoinIcon({left: false, center: true, right: false});
const LeftJoinIcon = createJoinIcon({left: true, center: true, right: false});
const RightJoinIcon = createJoinIcon({left: false, center: true, right: true});
const FullJoinIcon = createJoinIcon({left: true, right: true, center: true});

function createTableIcon(labelText? : string) {
    return function TableIcon({ style }: NodeIconProps) {
        const tableRowWidth = 5.2;
        const tableRowHeight = 2.8;
        const tableWidth = tableRowWidth * 3;
        const tableHeight = tableRowHeight * 4;
        const tableStartLeft = -tableWidth / 2;
        const tableStartTop = -tableHeight / 2;

        var content;
        if (labelText) {
            content = <text className="qg-table-text" y={tableRowHeight + 0.8 /* stroke-width */ / 2}>{labelText}</text>
        } else {
            content = <>
                <rect className="qg-table-border" x={tableStartLeft} width={tableWidth} y={0} height={tableRowHeight} fill="none"/>
                <rect className="qg-table-border" x={-tableRowWidth / 2} width={tableRowWidth} y={tableStartTop + tableRowHeight} height={tableHeight - tableRowHeight} fill="none"/>
            </>
        }

        return (
            <svg style={style} viewBox="-10 -10 20 20" className="qg-icon qg-expanded">
                <rect x={tableStartLeft} width={tableWidth} y={tableStartTop} height={tableHeight} fill="#fff" />
                <rect x={tableStartLeft} width={tableWidth} y={tableStartTop} height={tableRowHeight} fill="currentColor" />
                {content}
            </svg>
        )
    }
}

const TableIcon = createTableIcon();
const ConstTableIcon = createTableIcon("cnst");
const VirtualTableIcon = createTableIcon("dmv");
const TempTableIcon = createTableIcon("tmp");

export function NodeIcon({ icon, style }: NodeIconProps) {
    const iconTypes = {
        "run-query-symbol2": RunQueryIcon,
        "run-query-symbol": SortIcon,
        "filter-symbol": FilterIcon,
        "sort-symbol": SortIcon,
        "inner-join-symbol": InnerJoinIcon,
        "left-join-symbol": LeftJoinIcon,
        "right-join-symbol": RightJoinIcon,
        "full-join-symbol": FullJoinIcon,
        "table-symbol": TableIcon,
        "temp-table-symbol": TempTableIcon,
        "virtual-table-symbol": VirtualTableIcon,
        "const-table-symbol": ConstTableIcon,
    }
    const SelectedIcon = iconTypes[icon ?? ""] ?? DefaultIcon;
    return <SelectedIcon style={style} />
}
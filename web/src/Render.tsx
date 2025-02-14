import * as React from 'react';
import { AttributedText } from '../../src/printing/printer';
import { idName } from '../../src/typing/env';
import { GlobalEnv } from '../../src/typing/types';
import { Content } from './Cell';

const stylesForAttributes = (attributes: Array<string>) => {
    if (attributes.includes('string')) {
        return { color: '#ce9178' };
    }
    if (attributes.includes('int') || attributes.includes('float')) {
        return { color: '#b5cea8' };
    }
    if (attributes.includes('bool')) {
        return { color: '#DCDCAA' };
    }
    if (attributes.includes('keyword')) {
        return { color: '#C586C0' };
    }
    if (attributes.includes('literal')) {
        return { color: '#faa' };
    }
    return { color: '#aaa' };
};

const shouldShowHash = (
    env: GlobalEnv,
    id: string,
    kind: string,
    name: string,
) => {
    if (kind === 'term') {
        return !env.names[name] || idName(env.names[name]) !== id;
    } else if (kind === 'type' || kind === 'record' || kind === 'enum') {
        return !env.typeNames[name] || idName(env.typeNames[name]) !== id;
    }
    return false;
};

const colorsRaw =
    '1f77b4ff7f0e2ca02cd627289467bd8c564be377c27f7f7fbcbd2217becf';
const colors = [];
for (let i = 0; i < colorsRaw.length; i += 6) {
    colors.push('#' + colorsRaw.slice(i, i + 6));
}

export const renderAttributedTextToHTML = (
    env: GlobalEnv,
    text: Array<AttributedText>,
    allIds?: boolean,
    idColors: Array<string> = colors,
): string => {
    const colorMap = {};
    let colorAt = 0;
    return text
        .map((item, i) => {
            if (typeof item === 'string') {
                return item;
            }
            if ('kind' in item) {
                const showHash =
                    allIds ||
                    shouldShowHash(env, item.id, item.kind, item.text);
                if (!colorMap[item.id] && item.id.startsWith('sym')) {
                    colorMap[item.id] = idColors[colorAt++ % idColors.length];
                }
                return `<span style="color:${
                    item.kind === 'sym'
                        ? colorMap[item.id] || '#9CDCFE'
                        : '#4EC9B0'
                }" title="${item.id + ' ' + item.kind}">${item.text}${
                    showHash
                        ? `<span style="color: #777; font-size: 60%">#${item.id}</span>`
                        : ''
                }</span>`;
            }
            return `<span style="color:${
                stylesForAttributes(item.attributes).color
            }">${item.text}</span>`;
        })
        .join('');
};

export const renderAttributedText = (
    env: GlobalEnv,
    text: Array<AttributedText>,
    onClick?: (id: string, kind: string) => boolean | null,
    allIds?: boolean,
    idColors: Array<string> = colors,
) => {
    const colorMap = {};
    let colorAt = 0;
    return text.map((item, i) => {
        if (typeof item === 'string') {
            return <span key={i}>{item}</span>;
        }
        if ('kind' in item) {
            const showHash =
                allIds || shouldShowHash(env, item.id, item.kind, item.text);
            if (!colorMap[item.id] && item.id.startsWith('sym')) {
                colorMap[item.id] = idColors[colorAt++ % idColors.length];
            }
            return (
                <span
                    style={{
                        color:
                            item.kind === 'sym'
                                ? colorMap[item.id] || '#9CDCFE'
                                : '#4EC9B0',
                        cursor: onClick ? 'pointer' : 'inherit',
                    }}
                    onMouseDown={(evt) => {}}
                    onClick={(evt) => {
                        if (onClick && onClick(item.id, item.kind)) {
                            evt.preventDefault();
                            evt.stopPropagation();
                        }
                    }}
                    key={i}
                    title={item.id + ' ' + item.kind}
                >
                    {item.text}
                    {showHash ? (
                        <span
                            style={{
                                color: '#777',
                                fontSize: '60%',
                                //     borderBottom: item.id.startsWith('sym')
                                //         ? `1px solid ${colorMap[item.id]}`
                                //         : '',
                            }}
                        >
                            #{item.id}
                        </span>
                    ) : null}
                </span>
            );
        }
        return (
            <span style={stylesForAttributes(item.attributes)} key={i}>
                {item.text}
            </span>
        );
    });
};

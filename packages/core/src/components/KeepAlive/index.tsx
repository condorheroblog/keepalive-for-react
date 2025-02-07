import {
    ComponentType,
    Fragment,
    ReactElement,
    ReactNode,
    RefObject,
    useCallback,
    useImperativeHandle,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import { isArr, isFn, isNil, isRegExp, macroTask } from "../../utils";
import CacheComponentProvider from "../CacheComponentProvider";
import CacheComponent from "../CacheComponent";
import safeStartTransition from "../../compat/safeStartTransition";

export type KeepAliveChildren = ReactNode | ReactElement | null | undefined | JSX.Element;

export interface KeepAliveProps {
    activeCacheKey: string;
    children?: KeepAliveChildren;
    /**
     * max cache count default 10
     */
    max?: number;
    exclude?: Array<string | RegExp> | string | RegExp;
    include?: Array<string | RegExp> | string | RegExp;
    onBeforeActive?: (activeCacheKey: string) => void;
    customContainerRef?: RefObject<HTMLDivElement>;
    cacheNodeClassName?: string;
    containerClassName?: string;
    errorElement?: ComponentType<{
        children: ReactNode;
    }>;
    /**
     * transition default false
     */
    transition?: boolean;

    /**
     * view transition default false
     *
     * use viewTransition to animate the component when switching tabs
     *
     * @see https://developer.chrome.com/docs/web-platform/view-transitions/
     */
    viewTransition?: boolean;
    /**
     * transition duration default 200
     */
    duration?: number;
    aliveRef?: RefObject<KeepAliveRef | undefined>;
    /**
     * max alive time for cache node (second)
     * @default 0 (no limit)
     */
    maxAliveTime?: number | MaxAliveConfig[];
}

interface MaxAliveConfig {
    match: string | RegExp;
    expire: number;
}

export interface CacheNode {
    cacheKey: string;
    ele?: KeepAliveChildren;
    lastActiveTime: number;
    renderCount: number;
}

export interface KeepAliveAPI {
    /**
     * Refreshes the component.
     * @param {string} [cacheKey] - The cache key of the component. If not provided, the current cached component will be refreshed.
     */
    refresh: (cacheKey?: string) => void;
    /**
     * destroy the component
     * @param {string} [cacheKey] - the cache key of the component, if not provided, current active cached component will be destroyed
     */
    destroy: (cacheKey?: string | string[]) => Promise<void>;
    /**
     * destroy all components
     */
    destroyAll: () => Promise<void>;
    /**
     * destroy other components except the provided cacheKey
     * @param {string} [cacheKey] - The cache key of the component. If not provided, destroy all components except the current active cached component.
     */
    destroyOther: (cacheKey?: string) => Promise<void>;
    /**
     * get the cache nodes
     */
    getCacheNodes: () => Array<CacheNode>;
}

export interface KeepAliveRef extends KeepAliveAPI {}

export function useKeepAliveRef() {
    return useRef<KeepAliveRef>();
}

function KeepAlive(props: KeepAliveProps) {
    const {
        activeCacheKey,
        max = 10,
        exclude,
        include,
        onBeforeActive,
        customContainerRef,
        cacheNodeClassName = `cache-component`,
        containerClassName = "keep-alive-render",
        errorElement,
        transition = false,
        viewTransition = false,
        duration = 200,
        children,
        aliveRef,
        maxAliveTime = 0,
    } = props;

    const containerDivRef = customContainerRef || useRef<HTMLDivElement>(null);
    const [cacheNodes, setCacheNodes] = useState<Array<CacheNode>>([]);

    useLayoutEffect(() => {
        if (isNil(activeCacheKey)) return;
        safeStartTransition(() => {
            setCacheNodes(prevCacheNodes => {
                const lastActiveTime = Date.now();
                const cacheNode = prevCacheNodes.find(item => item.cacheKey === activeCacheKey);
                if (cacheNode) {
                    return prevCacheNodes.map(item => {
                        if (item.cacheKey === activeCacheKey) {
                            let needUpdate = false;
                            if (isFn(onBeforeActive)) onBeforeActive(activeCacheKey);
                            if (maxAliveTime) {
                                const prev = item.lastActiveTime;
                                if (isArr(maxAliveTime)) {
                                    const config = maxAliveTime.find(item => {
                                        return isRegExp(item.match) ? item.match.test(activeCacheKey) : item.match === activeCacheKey;
                                    });
                                    if (config) {
                                        needUpdate = config && prev + config.expire * 1000 < lastActiveTime;
                                    }
                                } else {
                                    needUpdate = prev + maxAliveTime * 1000 < lastActiveTime;
                                }
                            }
                            return {
                                ...item,
                                ele: children,
                                lastActiveTime,
                                renderCount: needUpdate ? item.renderCount + 1 : item.renderCount,
                            };
                        }
                        return item;
                    });
                } else {
                    if (isFn(onBeforeActive)) onBeforeActive(activeCacheKey);
                    if (prevCacheNodes.length > max) {
                        const node = prevCacheNodes.reduce((prev, cur) => {
                            return prev.lastActiveTime < cur.lastActiveTime ? prev : cur;
                        });
                        prevCacheNodes.splice(prevCacheNodes.indexOf(node), 1);
                    }
                    return [...prevCacheNodes, { cacheKey: activeCacheKey, lastActiveTime, ele: children, renderCount: 0 }];
                }
            });
        });
    }, [activeCacheKey, children]);

    const refresh = useCallback(
        (cacheKey?: string) => {
            setCacheNodes(cacheNodes => {
                const targetCacheKey = cacheKey || activeCacheKey;
                return cacheNodes.map(item => {
                    if (item.cacheKey === targetCacheKey) {
                        return { ...item, renderCount: item.renderCount + 1 };
                    }
                    return item;
                });
            });
        },
        [setCacheNodes, activeCacheKey],
    );

    const destroy = useCallback(
        (cacheKey?: string | string[]) => {
            const targetCacheKey = cacheKey || activeCacheKey;
            const cacheKeys = isArr(targetCacheKey) ? targetCacheKey : [targetCacheKey];
            return new Promise<void>(resolve => {
                macroTask(() => {
                    setCacheNodes(cacheNodes => {
                        return [...cacheNodes.filter(item => !cacheKeys.includes(item.cacheKey))];
                    });
                    resolve();
                });
            });
        },
        [setCacheNodes, activeCacheKey],
    );

    const destroyAll = useCallback(() => {
        return new Promise<void>(resolve => {
            macroTask(() => {
                setCacheNodes([]);
                resolve();
            });
        });
    }, [setCacheNodes]);

    const destroyOther = useCallback(
        (cacheKey?: string) => {
            const targetCacheKey = cacheKey || activeCacheKey;
            return new Promise<void>(resolve => {
                macroTask(() => {
                    setCacheNodes(cacheNodes => {
                        return [...cacheNodes.filter(item => item.cacheKey === targetCacheKey)];
                    });
                    resolve();
                });
            });
        },
        [activeCacheKey, setCacheNodes],
    );

    const getCacheNodes = useCallback(() => {
        return cacheNodes;
    }, [cacheNodes]);

    useImperativeHandle(aliveRef, () => ({
        refresh,
        destroy,
        destroyAll,
        destroyOther,
        getCacheNodes,
    }));

    return (
        <Fragment>
            <div ref={containerDivRef} className={containerClassName} style={{ height: "100%" }}></div>
            {cacheNodes.map(item => {
                const { cacheKey, ele, renderCount } = item;
                return (
                    <CacheComponentProvider
                        key={`${cacheKey}-${renderCount}`}
                        active={activeCacheKey === cacheKey}
                        refresh={refresh}
                        destroy={destroy}
                        destroyAll={destroyAll}
                        destroyOther={destroyOther}
                        getCacheNodes={getCacheNodes}
                    >
                        <CacheComponent
                            destroy={destroy}
                            include={include}
                            exclude={exclude}
                            transition={transition}
                            viewTransition={viewTransition}
                            duration={duration}
                            renderCount={renderCount}
                            containerDivRef={containerDivRef}
                            errorElement={errorElement}
                            active={activeCacheKey === cacheKey}
                            cacheNodeClassName={cacheNodeClassName}
                            cacheKey={cacheKey}
                        >
                            {ele}
                        </CacheComponent>
                    </CacheComponentProvider>
                );
            })}
        </Fragment>
    );
}

export default KeepAlive;

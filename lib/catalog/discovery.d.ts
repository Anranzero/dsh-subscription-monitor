export declare const MODEL_DISCOVERY_TTL_MS: number;
export declare const positiveLimit: (value: any) => number | undefined;
export declare const modelText: (value: any) => string;
export declare function modelInput(values: any): string[] | undefined;
export declare function modelEfforts(values: any, offValue?: string | null): Record<string, string | null> | undefined;
export declare function mergeCatalogFloor(listed: any[], floor: readonly any[]): any[];
export declare function discoverySignal(signal?: AbortSignal): AbortSignal;
export declare function readModelList(fetchFn: any, url: string, init?: any): Promise<any>;

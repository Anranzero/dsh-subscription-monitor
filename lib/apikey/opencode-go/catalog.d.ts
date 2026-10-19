/**
 * OpenCode Go live catalog: curated rows per wire protocol, refreshed from the
 * account's keyed /models list.
 */
export declare const OPENCODE_GO_MODELS_URL = "https://opencode.ai/zen/go/v1/models";
export declare const OPENCODE_GO_MODELS_DEV_URL = "https://models.dev/api.json";
export declare const OPENCODE_GO_CATALOG_TTL_MS: number;
export declare function resetOpencodeGoCatalogCache(): void;
export declare function opencodeGoCatalogRows(): {
    route: string;
    row: any;
}[];
export declare function opencodeGoRouteModels(routeId: string): any[];
export declare function mergeOpencodeGoModels(listed: any[], modelsDev?: Record<string, any>): {
    route: string;
    row: any;
}[];
export declare function refreshOpencodeGoCatalog(session: any, options?: any): Promise<any>;

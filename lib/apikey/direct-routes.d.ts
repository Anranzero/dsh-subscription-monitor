import type { HarnessProvider } from '../oauth/models.js';
export declare function directApiKeyProviders(providers: Record<string, HarnessProvider>, options?: { commandCodePlan?: string }): Record<string, HarnessProvider>;
export declare function mirrorDirectApiKeys(options: { credentials?: any; authPath?: string }): Promise<{ commandCodePlan?: string }>;

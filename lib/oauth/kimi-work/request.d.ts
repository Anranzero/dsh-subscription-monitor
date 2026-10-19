/**
 * Kimi Work Completions hop.
 *
 * The wire takes the plain OpenAI `reasoning_effort` field with the
 * gateway's own advertised value (the upstream package's model variants each
 * carry `reasoningEffort: <effort>`, the lowercased `REASONING_EFFORT_*`
 * spelling) — NOT the `thinking` object the Kimi Code hop uses. Map the DSH
 * key onto the row's advertised value; a level the row does not map goes out
 * as the nearest advertised rung (never a rung the model does not serve), and
 * a model that does not reason loses the field.
 */
export declare function applyKimiWorkThinking(payload?: any, model?: any): any;
/** Map vendor cache-read aliases. Absent field stays absent — do not invent 0. */
export declare function mapKimiWorkUsage(usage: any): any;

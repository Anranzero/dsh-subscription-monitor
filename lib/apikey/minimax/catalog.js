/**
 * MiniMax model list. The published catalog is short and stable, so this is a
 * static floor rather than a live refresh: GET /v1/models is OpenAI-shaped but
 * carries no context window or modality, so a live read would not tell the
 * picker anything the static rows do not already say.
 */
import { MINIMAX_MODELS } from './index.js';
export function minimaxCatalogModels() {
    return [...MINIMAX_MODELS];
}
export function resetMinimaxCatalogCache() {
    /* nothing cached */
}
export async function refreshMinimaxCatalog() {
    return minimaxCatalogModels();
}

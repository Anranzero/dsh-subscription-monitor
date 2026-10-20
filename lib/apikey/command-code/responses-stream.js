import { scanSseFrame } from '../../oauth/responses-sse.js';

const VENDOR_DELTA = 'response.reasoning.delta';
const RESPONSES_DELTA = 'response.reasoning_text.delta';

function normalizeFrame(bytes) {
    const frame = bytes.toString('utf8');
    const { data } = scanSseFrame(frame, VENDOR_DELTA);
    if (data?.type !== VENDOR_DELTA || typeof data.delta !== 'string')
        return bytes;
    const newline = frame.includes('\r\n') ? '\r\n' : '\n';
    let wroteData = false;
    const lines = frame.split(/\r?\n/).flatMap((line) => {
        if (line.startsWith('event:') && line.slice(6).trim() === VENDOR_DELTA)
            return [`event: ${RESPONSES_DELTA}`];
        if (!line.startsWith('data:'))
            return [line];
        if (wroteData)
            return [];
        wroteData = true;
        return [`data: ${JSON.stringify({ ...data, type: RESPONSES_DELTA })}`];
    });
    return Buffer.from(lines.join(newline), 'utf8');
}

/**
 * Command Code's Responses stream uses response.reasoning.delta. pi-ai reads
 * response.reasoning_text.delta; without this alias it only sees reasoning at
 * output_item.done, falsely turning an entire thinking interval into TTFT.
 * Transform complete SSE frames as they arrive, never buffer the whole reply.
 */
export function normalizeCommandCodeResponsesStream(response) {
    if (!response.ok || !response.body || !response.headers.get('content-type')?.toLowerCase().includes('text/event-stream'))
        return response;
    let tail = '';
    const body = response.body.pipeThrough(new TransformStream({
        transform(chunk, controller) {
            // Latin1 preserves bytes until a frame is complete, including UTF-8
            // characters or CRLF separators split across transport chunks.
            const from = Math.max(0, tail.length - 3);
            tail += Buffer.from(chunk).toString('latin1');
            const separator = /\r?\n\r?\n/g;
            separator.lastIndex = from;
            let start = 0;
            for (let match = separator.exec(tail); match; match = separator.exec(tail)) {
                const end = match.index + match[0].length;
                controller.enqueue(normalizeFrame(Buffer.from(tail.slice(start, end), 'latin1')));
                start = end;
            }
            tail = tail.slice(start);
        },
        flush(controller) {
            // Preserve an incomplete tail so the SDK still detects truncation.
            if (tail)
                controller.enqueue(Buffer.from(tail, 'latin1'));
        },
    }));
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

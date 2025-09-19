import { headersToObject } from './utils.js';
export async function parseResponse(response, responseType, source, requestId) {
    let data;
    switch (responseType) {
        case 'text':
            data = await response.text();
            break;
        case 'blob':
            data = await response.blob();
            break;
        case 'arrayBuffer':
            data = await response.arrayBuffer();
            break;
        case 'formData':
            data = await response.formData();
            break;
        case 'raw':
            data = response;
            break;
        case 'json':
        default:
            data = await safeJsonParse(response);
            break;
    }
    const parsed = {
        status: response.status,
        headers: headersToObject(response.headers),
        data: data,
        source,
    };
    if (requestId) {
        parsed.requestId = requestId;
    }
    return parsed;
}
async function safeJsonParse(response) {
    const text = await response.text();
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text);
    }
    catch (error) {
        throw new Error(`Failed to parse JSON response: ${error.message}`);
    }
}
//# sourceMappingURL=response.js.map
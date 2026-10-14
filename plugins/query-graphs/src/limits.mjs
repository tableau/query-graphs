export const RESOURCE_URI = "ui://query-graphs/view.html";
// This plugin policy is independent of any particular host's transport limit.
export const MAX_MCP_MESSAGE_BYTES = 8 * 1024 * 1024;
// The tool handler does not see the JSON-RPC request id or outer response envelope.
export const RESPONSE_ENVELOPE_HEADROOM_BYTES = 64 * 1024;
export const MAX_FILE_BYTES = MAX_MCP_MESSAGE_BYTES - RESPONSE_ENVELOPE_HEADROOM_BYTES;
export const MAX_APP_HTML_BYTES = 10_000_000;
export const MAX_RELEASE_ASSET_BYTES = 10 * 1024 * 1024;

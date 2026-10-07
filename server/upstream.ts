import type { Config } from "./config";
import type { Service } from "../shared/resources";
import { ApiError, parseWire } from "./wire";

export type Transport = typeof fetch;
export interface UpstreamResult {
  data: unknown;
  headers: Headers;
  status: number;
}
export function createUpstream(config: Config, transport: Transport = fetch) {
  return async (
    service: Service,
    path: string,
    token?: string,
    options: {
      method?: string;
      query?: Record<string, string>;
      body?: string;
    } = {},
  ): Promise<UpstreamResult> => {
    const origin = config.origins[service];
    if (!origin)
      throw new ApiError(
        503,
        `${service} service is not configured.`,
        undefined,
        "service_unconfigured",
      );
    if (!path.startsWith("/v1/") && !path.startsWith("/_health/"))
      throw new ApiError(400, "Unsupported service route.");
    const url = new URL(path, origin);
    for (const [key, value] of Object.entries(options.query ?? {}))
      url.searchParams.set(key, value);
    const headers = new Headers({
      Accept: "application/json",
      "X-Request-ID": crypto.randomUUID(),
    });
    if (token) headers.set("Token", token);
    if (options.body) headers.set("Content-Type", "application/json");
    let response: Response;
    try {
      response = await transport(url, {
        method: options.method ?? "GET",
        headers,
        body: options.body,
        redirect: "error",
        signal: AbortSignal.timeout(config.requestTimeoutMs),
      });
    } catch {
      throw new ApiError(
        502,
        "The service could not be reached. Try again.",
        undefined,
        "upstream_unavailable",
      );
    }
    // Bound response allocation before parsing. Never include upstream bodies or credential-bearing URLs in logs/errors.
    const reader = response.body?.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    if (reader)
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 24 * 1024 * 1024) {
          await reader.cancel();
          throw new ApiError(
            502,
            "The result is too large. Narrow the filters.",
          );
        }
        chunks.push(value);
      }
    const text = Buffer.concat(chunks).toString("utf8");
    if (!response.ok) {
      const messages: Record<number, string> = {
        400: "The service rejected the request. Check the selected values.",
        401: "Your session has expired. Sign in again.",
        403: "You do not have permission for this operation.",
        404: "This record could not be found.",
        409: "This change conflicts with the current record or its dependencies. Refresh and try again.",
        422: "The service rejected one or more values. Check the form.",
        503: "This service is not ready for the operation. Writes may be paused during migration.",
      };
      throw new ApiError(
        response.status >= 500 ? 503 : response.status,
        messages[response.status] ??
          "The service could not complete the operation.",
        undefined,
        `upstream_${response.status}`,
      );
    }
    const data = parseWire(text);
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const obj = data as Record<string, unknown>;
      if (obj.status === false || obj.Status === false)
        throw new ApiError(
          path.endsWith("/connect") || path.endsWith("/info") ? 401 : 409,
          path.endsWith("/connect")
            ? "The login or password is incorrect."
            : "The service declined the operation.",
          undefined,
          "business_failure",
        );
    }
    return { data, headers: response.headers, status: response.status };
  };
}

import { decodeHubOnline, type HubOnlineHours } from "../shared/hub-online";
import { resourceMap, valueOf } from "../shared/resources";
import type { createAuthorization } from "./authorization";
import type { Session } from "./sessions";
import type { createUpstream } from "./upstream";
import { ApiError } from "./wire";

export async function hubOnline(
  hubId: string,
  hours: HubOnlineHours,
  session: Session,
  upstream: ReturnType<typeof createUpstream>,
  authorization: ReturnType<typeof createAuthorization>,
  organization?: string,
) {
  const authorize = async () => {
    const hub = await authorization.read(session, "hubs", hubId);
    if (
      !(await authorization.scopeRecords(session, resourceMap.hubs, [hub]))
        .length ||
      (organization !== undefined &&
        valueOf(hub, "IDOrganization") !== organization)
    )
      throw new ApiError(403, "This hub is outside your access.");
  };
  await authorize();
  const decode = (input: unknown) => {
    try {
      return decodeHubOnline(input, hubId, hours);
    } catch {
      throw new ApiError(502, "Hub online history is unavailable.");
    }
  };
  let data: unknown;
  try {
    ({ data } = await upstream(
      "core",
      `/v1/hubs/${hubId}/online`,
      session.token,
      {
        query: { hours: String(hours) },
        validateResponse: (body) => {
          decode(JSON.parse(body));
        },
      },
    ));
  } catch (error) {
    if (error instanceof ApiError && [404, 405].includes(error.status))
      throw new ApiError(
        503,
        "Hub online history is not available from this Core service.",
      );
    throw error;
  }
  const response = decode(data);
  await authorize();
  return response;
}

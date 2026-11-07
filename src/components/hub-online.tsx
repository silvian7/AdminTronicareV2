import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Select, Skeleton } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useSearchParams } from "react-router";
import {
  decodeHubOnline,
  type HubOnlineResponse,
} from "../../shared/hub-online";
import {
  DISPLAY_TIME_ZONE,
  formatDisplayClock,
  formatDisplayDate,
  formatDisplayDateTime,
} from "../../shared/date-time";
import { resourceMap } from "../../shared/resources";
import { getSessionEpoch, request } from "../api";
import { useAdmin } from "../context";
import { useOperationalRefresh } from "./operational-freshness";
import "./hub-online.css";

type Hours = 24 | 48 | 168;
const spans = [
  { value: 24, label: "Past 24 hours" },
  { value: 48, label: "Past 48 hours" },
  { value: 168, label: "Past 7 days" },
];

function ActivityTimeline({ data }: { data: HubOnlineResponse }) {
  const pattern = `hub-online-unknown-${useId().replace(/:/g, "")}`;
  const start = Date.parse(data.rangeStart);
  const end = Date.parse(data.rangeEnd);
  const width = end - start;
  const recorded = data.buckets.filter(
    (bucket) => bucket.receivedCount !== null,
  );
  const active = recorded.filter((bucket) => BigInt(bucket.receivedCount!) > 0);
  const position = (value: string) =>
    ((Date.parse(value) - start) / width) * 1000;
  const description =
    recorded.length === 0
      ? "Activity counts are incomplete for this period."
      : `${active.length} of ${recorded.length} recorded five-minute intervals contain activity${recorded.length < data.buckets.length ? "; earlier intervals are unknown" : ""}.`;
  return (
    <>
      <p className="hub-online-summary">{description}</p>
      <div className="hub-online-chart">
        <svg
          className="hub-online-timeline"
          viewBox="0 0 1000 80"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Hub activity over the past ${data.hours} hours. ${description}`}
        >
          <defs>
            <pattern
              id={pattern}
              patternUnits="userSpaceOnUse"
              width="7"
              height="7"
              patternTransform="rotate(45)"
            >
              <rect width="7" height="7" fill="#edf1f5" />
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="7"
                stroke="#8797a7"
                strokeWidth="2"
              />
            </pattern>
          </defs>
          {data.buckets.map((bucket) => {
            const state =
              bucket.receivedCount === null
                ? "unknown"
                : BigInt(bucket.receivedCount) > 0
                  ? "active"
                  : "empty";
            const label =
              state === "unknown"
                ? "Unknown / incomplete"
                : state === "active"
                  ? `${bucket.receivedCount} activity events received`
                  : "No activity recorded";
            return (
              <rect
                key={bucket.start}
                x={position(bucket.start)}
                y="8"
                width={position(bucket.end) - position(bucket.start) + 0.1}
                height="64"
                className={`hub-online-bucket hub-online-bucket-${state}`}
                data-state={state}
                fill={state === "unknown" ? `url(#${pattern})` : undefined}
              >
                <title>{`${formatDisplayDateTime(bucket.start)} – ${formatDisplayDateTime(bucket.end)} (${DISPLAY_TIME_ZONE}): ${label}`}</title>
              </rect>
            );
          })}
        </svg>
        <div className="hub-online-axis" aria-hidden="true">
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
            const at = start + fraction * width;
            return (
              <span key={fraction}>
                {formatDisplayClock(at, { second: undefined })}
                <small>{formatDisplayDate(at)}</small>
              </span>
            );
          })}
        </div>
      </div>
      <ul className="hub-online-legend" aria-label="Activity legend">
        <li>
          <span className="hub-online-swatch hub-online-swatch-active" />
          Activity received
        </li>
        <li>
          <span className="hub-online-swatch hub-online-swatch-empty" />
          No activity recorded
        </li>
        <li>
          <span className="hub-online-swatch hub-online-swatch-unknown" />
          Unknown / incomplete
        </li>
      </ul>
      {active.length === 0 && !data.limited && (
        <p className="hub-online-note">
          No activity was recorded in this period.
        </p>
      )}
    </>
  );
}

export function HubOnline({ hubId, ready }: { hubId: string; ready: boolean }) {
  const { organization, can } = useAdmin();
  const [params, setParams] = useSearchParams();
  const value = params.get("onlineHours");
  const hours: Hours = value === "48" ? 48 : value === "168" ? 168 : 24;
  const enabled = ready && can(resourceMap.hubs, "show");
  const query = useQuery({
    queryKey: ["hub-online", getSessionEpoch(), organization, hubId, hours],
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    meta: { hubOnline: true, organization },
    queryFn: async ({ signal }) => {
      const search = new URLSearchParams({ hours: String(hours) });
      if (organization) search.set("_organization", organization);
      return decodeHubOnline(
        await request<unknown>(
          `/api/hubs/${encodeURIComponent(hubId)}/online?${search}`,
          { signal },
        ),
        hubId,
        hours,
      );
    },
  });
  useOperationalRefresh(enabled, query.refetch, 60_000);
  const data =
    enabled && !query.isError && !query.isPlaceholderData
      ? query.data
      : undefined;
  const refresh = () => void query.refetch({ cancelRefetch: false });
  return (
    <section className="hub-online" aria-label="Hub online activity">
      <div className="hub-online-controls">
        <label htmlFor="hub-online-span">Time span</label>
        <Select
          id="hub-online-span"
          aria-label="Time span"
          value={hours}
          options={spans}
          onChange={(next: Hours) =>
            setParams((previous) => {
              const updated = new URLSearchParams(previous);
              if (next === 24) updated.delete("onlineHours");
              else updated.set("onlineHours", String(next));
              return updated;
            })
          }
        />
        <Button
          icon={<ReloadOutlined aria-hidden="true" />}
          onClick={refresh}
          loading={query.isFetching}
          disabled={!enabled}
          aria-label="Refresh hub activity"
        >
          Refresh
        </Button>
      </div>
      {query.isError ? (
        <Alert
          type="error"
          showIcon
          message="Hub activity unavailable"
          description={query.error.message}
          action={<Button onClick={refresh}>Retry</Button>}
        />
      ) : !data ? (
        <Skeleton
          active
          aria-label="Loading hub activity"
          paragraph={{ rows: 3 }}
        />
      ) : (
        <>
          {data.limited && (
            <Alert
              type="warning"
              showIcon
              message="Incomplete activity history"
              description="The retained activity scan reached its limit. Earlier intervals are marked unknown."
            />
          )}
          <ActivityTimeline data={data} />
          <p className="hub-online-note">
            Each interval covers 5 minutes of retained activity. Gaps do not
            confirm that the hub was offline. Times are shown in{" "}
            {DISPLAY_TIME_ZONE}.
          </p>
          <p className="hub-online-observed">
            Observed through{" "}
            <time dateTime={data.observedAt}>
              {formatDisplayDateTime(data.observedAt)}
            </time>
            .
          </p>
        </>
      )}
    </section>
  );
}

import { useEffect } from "react";
import { focusManager } from "@tanstack/react-query";
import { Typography } from "antd";

interface OperationalQuery {
  refetch(options: { cancelRefetch: false }): Promise<unknown>;
}

// One refresh owner per mounted operational view. A visible dashboard keeps
// updating when another window has focus; hidden documents perform no polls.
export function useOperationalRefresh(
  enabled: boolean,
  refetch: OperationalQuery["refetch"],
) {
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      // Focus, timer and manual requests share the query's current in-flight work.
      void refetch({ cancelRefetch: false }).catch(() => {});
    };
    const timer = window.setInterval(refresh, 15_000);
    const unsubscribe = focusManager.subscribe((focused) => {
      if (focused) refresh();
    });
    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [enabled, refetch]);
}

export function LastRefreshed({
  dataUpdatedAt,
  isFetching,
  isError,
}: {
  dataUpdatedAt: number;
  isFetching: boolean;
  isError: boolean;
}) {
  const date = dataUpdatedAt > 0 ? new Date(dataUpdatedAt) : undefined;
  return (
    <Typography.Paragraph
      className="operational-freshness"
      type={isError ? "warning" : "secondary"}
      aria-label="View freshness"
    >
      Last refreshed:{" "}
      {date ? (
        <time
          dateTime={date.toISOString()}
          title={Intl.DateTimeFormat().resolvedOptions().timeZone}
        >
          {date.toLocaleString(undefined, { hourCycle: "h23" })}
        </time>
      ) : (
        "Not yet available"
      )}
      {isFetching ? " · Refreshing…" : isError ? " · Refresh failed" : ""}. This
      is the last successful fetch; device event times are separate.
    </Typography.Paragraph>
  );
}

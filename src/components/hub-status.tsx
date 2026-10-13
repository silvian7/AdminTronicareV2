import { hubLastEventTime } from "../../shared/hub-status";

export function HubStatus({ value, now }: { value: unknown; now: number }) {
  const event = hubLastEventTime(value);
  const age = event === null ? Infinity : Math.max(0, now - event);
  const status =
    age < 5 * 60_000
      ? "green"
      : age <= 60 * 60_000
        ? "yellow"
        : age <= 8 * 60 * 60_000
          ? "red"
          : "black";
  const description =
    event === null
      ? "Last event unavailable"
      : event > now
        ? "Last event is in the future"
        : {
            green: "Last event: less than 5 minutes ago",
            yellow: "Last event: 5 minutes to 1 hour ago",
            red: "Last event: more than 1 hour to 8 hours ago",
            black: "Last event: more than 8 hours ago",
          }[status];
  return (
    <span
      className="hub-status-dot"
      data-status={status}
      role="img"
      aria-label={description}
      title={description}
    />
  );
}

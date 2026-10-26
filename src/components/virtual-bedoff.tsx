import { useEffect, useRef, useState } from "react";
import { useInvalidate, useOne } from "@refinedev/core";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Space, Typography } from "antd";
import {
  resourceMap,
  translated,
  valueOf,
  type RecordData,
} from "../../shared/resources";
import { isVirtualRecord } from "../../shared/virtual";
import { hubLastEventTime } from "../../shared/hub-status";
import { getSessionEpoch, request, subscribeSessionChange } from "../api";
import { useAdmin } from "../context";

type Receipt = {
  sensorId: string;
  operationId: string;
  value: boolean;
  status: "queued" | "accepted" | "rejected";
  eventAt: string;
  acceptedAt?: string;
};
type Operation = { operationId: string; value: boolean; receipt?: Receipt };
const pendingOperations = new Map<string, Operation>();
// Retain an uncertain operation across views, but never across account contexts.
subscribeSessionChange(() => pendingOperations.clear());
const positiveId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[1-9]\d{0,18}$/.test(value) &&
  BigInt(value) <= 9223372036854775807n;
const validTime = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
function receiptFor(
  value: unknown,
  sensorId: string,
  operation: Operation,
): Receipt {
  const data = value as Partial<Receipt> | null;
  if (
    !data ||
    data.sensorId !== sensorId ||
    data.operationId !== operation.operationId ||
    data.value !== operation.value ||
    (data.status !== "queued" &&
      data.status !== "accepted" &&
      data.status !== "rejected") ||
    !validTime(data.eventAt) ||
    (data.acceptedAt !== undefined && !validTime(data.acceptedAt))
  )
    throw new Error("The simulation response could not be confirmed.");
  return data as Receipt;
}
function pause(signal: AbortSignal, milliseconds: number) {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) return resolve(false);
    const stop = () => {
      window.clearTimeout(timer);
      resolve(false);
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve(true);
    }, milliseconds);
    signal.addEventListener("abort", stop, { once: true });
  });
}
function bedState(value: unknown) {
  return value === false
    ? "Bed occupied"
    : value === true
      ? "Bed vacant"
      : "Unavailable";
}

export function VirtualBedoffControls({
  row,
  card = false,
}: {
  row: RecordData;
  card?: boolean;
}) {
  const { identity, organization, can } = useAdmin();
  const invalidate = useInvalidate();
  const sensorId = positiveId(row.id) ? row.id : "";
  const typeId = valueOf(row, "IDSensorType");
  const epoch = getSessionEpoch();
  const scope = `${epoch}:${organization}:${sensorId}`;
  const candidate =
    !!sensorId &&
    isVirtualRecord(row) &&
    identity.level >= 90 &&
    can(resourceMap.sensors, "show") &&
    can(resourceMap.sensors, "edit") &&
    positiveId(typeId);
  const type = useOne<RecordData>({
    resource: "sensortypes",
    id: positiveId(typeId) ? typeId : "0",
    meta: { organization },
    queryOptions: {
      enabled: candidate && can(resourceMap.sensortypes, "show"),
      meta: { equipmentTypeReference: true, organization },
    },
    errorNotification: false,
  });
  const hardwareType = valueOf(type.result ?? {}, "HardwareType");
  const valueType = valueOf(type.result ?? {}, "ValueType");
  const eligible =
    candidate &&
    can(resourceMap.sensortypes, "show") &&
    !type.query.isError &&
    type.result?.id === typeId &&
    typeof hardwareType === "string" &&
    hardwareType.trim().replace(/[A-Z]/g, (letter) => letter.toLowerCase()) ===
      "bedoff" &&
    (valueType === "1" || valueType === 1);
  const capability = useQuery({
    queryKey: [
      "virtual-bedoff-capability",
      epoch,
      organization,
      sensorId,
      translated(valueOf(row, "Tag")),
      typeId,
    ],
    enabled: eligible,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const result = await request<{
        data: { sensorId: string; supported: boolean };
      }>(`/api/sensors/${sensorId}/virtual-events`, { signal });
      if (
        result.data?.sensorId !== sensorId ||
        typeof result.data.supported !== "boolean"
      )
        throw new Error("Simulation availability could not be confirmed.");
      return result.data;
    },
  });
  const supported =
    eligible &&
    capability.isSuccess &&
    !capability.isPlaceholderData &&
    capability.data.sensorId === sensorId &&
    capability.data.supported;
  const [pending, setPending] = useState<
    { scope: string; operation: Operation } | undefined
  >(() => {
    const operation = pendingOperations.get(scope);
    return operation ? { scope, operation } : undefined;
  });
  const [receipt, setReceipt] = useState<{ scope: string; data: Receipt }>();
  const [error, setError] = useState<{
    scope: string;
    message: string;
    uncertain: boolean;
  }>();
  const [busyScope, setBusyScope] = useState<string>();
  const mounted = useRef(false);
  const currentScope = useRef(scope);
  const allowed = useRef(supported);
  const latestRow = useRef(row);
  const running = useRef<symbol | null>(null);
  const controller = useRef<AbortController | null>(null);
  currentScope.current = scope;
  allowed.current = supported;
  latestRow.current = row;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      running.current = null;
    };
  }, []);
  useEffect(() => {
    controller.current?.abort();
    running.current = null;
    controller.current = null;
    setBusyScope(undefined);
    const operation = pendingOperations.get(scope);
    setPending(operation ? { scope, operation } : undefined);
    setReceipt(undefined);
    setError(undefined);
  }, [scope]);
  useEffect(() => {
    if (!supported) controller.current?.abort();
  }, [supported]);
  const unresolved =
    pending?.scope === scope ? pending.operation : pendingOperations.get(scope);
  const shownReceipt =
    receipt?.scope === scope ? receipt.data : unresolved?.receipt;
  const shownError = error?.scope === scope ? error.message : undefined;
  const busy = busyScope === scope;

  async function run(operation: Operation, retry: boolean) {
    if (
      !supported ||
      !allowed.current ||
      running.current ||
      !mounted.current ||
      currentScope.current !== scope ||
      getSessionEpoch() !== epoch
    )
      return;
    const token = Symbol();
    const abort = new AbortController();
    running.current = token;
    controller.current = abort;
    const current = () =>
      mounted.current &&
      currentScope.current === scope &&
      getSessionEpoch() === epoch &&
      running.current === token &&
      allowed.current;
    const endpoint = `/api/sensors/${sensorId}/virtual-events`;
    const readReceipt = async (path: string, options: RequestInit = {}) => {
      const response = await request<{ data: unknown }>(path, {
        ...options,
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(8_000)]),
      });
      return receiptFor(response.data, sensorId, operation);
    };
    const send = () =>
      readReceipt(endpoint, {
        method: "POST",
        body: JSON.stringify({
          operationId: operation.operationId,
          value: operation.value,
        }),
      });
    pendingOperations.set(scope, operation);
    setPending({ scope, operation });
    setBusyScope(scope);
    setError(undefined);
    setReceipt(undefined);
    try {
      let result: Receipt;
      if (retry) {
        let existing = false;
        try {
          result = await readReceipt(`${endpoint}/${operation.operationId}`);
          existing = true;
        } catch (failure) {
          if (!current()) return;
          if ((failure as { statusCode?: number }).statusCode !== 404)
            throw failure;
          // A retry is explicit and always retains the original event identity.
          result = await send();
        }
        if (!current()) return;
        if (existing && result.status === "queued") result = await send();
      } else result = await send();
      if (!current()) return;
      for (
        let attempt = 0;
        result.status === "queued" && attempt < 3;
        attempt += 1
      ) {
        const updated = { ...operation, receipt: result };
        pendingOperations.set(scope, updated);
        setPending({ scope, operation: updated });
        setReceipt({ scope, data: result });
        if (!(await pause(abort.signal, 1_000)) || !current()) return;
        result = await readReceipt(`${endpoint}/${operation.operationId}`);
        if (!current()) return;
      }
      setReceipt({ scope, data: result });
      if (result.status === "queued") {
        const updated = { ...operation, receipt: result };
        pendingOperations.set(scope, updated);
        setPending({ scope, operation: updated });
        return;
      }
      pendingOperations.delete(scope);
      setPending(undefined);
      if (result.status === "rejected") return;
      // Read back through the normal queries. Acceptance is not processing.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (!current()) return;
        await invalidate({
          resource: "sensors",
          id: sensorId,
          invalidates: ["detail", "list"],
        });
        if (!current()) return;
        if (!(await pause(abort.signal, 0)) || !current()) return;
        const readingAt = hubLastEventTime(
          valueOf(latestRow.current, "DhLastEvent"),
        );
        if (
          valueOf(latestRow.current, "ValueBool") === operation.value &&
          readingAt !== null &&
          readingAt >= Date.parse(result.eventAt)
        )
          break;
        if (attempt < 2 && (!(await pause(abort.signal, 1_000)) || !current()))
          return;
      }
    } catch (failure) {
      if (current())
        setError({
          scope,
          message:
            (failure as Error).message || "Simulation could not be confirmed.",
          uncertain: pendingOperations.has(scope),
        });
    } finally {
      if (running.current === token) {
        running.current = null;
        controller.current = null;
        if (
          mounted.current &&
          currentScope.current === scope &&
          getSessionEpoch() === epoch
        )
          setBusyScope(undefined);
      }
    }
  }
  if (!eligible) return null;
  if (!supported) {
    if (!capability.isError) return null;
    const notice = (
      <Alert
        type="warning"
        message="Simulation availability could not be confirmed."
        action={
          <Button size="small" onClick={() => void capability.refetch()}>
            Retry availability
          </Button>
        }
      />
    );
    return card ? (
      <Card className="form-section" title="Simulation">
        {notice}
      </Card>
    ) : (
      notice
    );
  }
  const content = (
    <div className="virtual-bedoff-controls" data-no-row-navigation>
      <Typography.Text>
        Current reading: {bedState(valueOf(row, "ValueBool"))}
      </Typography.Text>
      <Space wrap>
        <Button
          size={card ? "middle" : "small"}
          disabled={busy || !!unresolved}
          onClick={() =>
            void run({ operationId: crypto.randomUUID(), value: false }, false)
          }
        >
          Bed occupied
        </Button>
        <Button
          size={card ? "middle" : "small"}
          disabled={busy || !!unresolved}
          onClick={() =>
            void run({ operationId: crypto.randomUUID(), value: true }, false)
          }
        >
          Bed vacant
        </Button>
      </Space>
      <Typography.Text type="secondary">
        Sends simulated telemetry. Sensor readings confirm the current state.
      </Typography.Text>
      {shownReceipt && (
        <Alert
          type={shownReceipt.status === "rejected" ? "error" : "info"}
          showIcon
          message={
            shownReceipt.status === "accepted"
              ? "Telemetry accepted. Readings update after processing."
              : shownReceipt.status === "rejected"
                ? "Telemetry was rejected. The sensor reading is unchanged."
                : "Telemetry queued. Processing is not confirmed."
          }
        />
      )}
      {shownError && (
        <Alert
          type="error"
          showIcon
          message={shownError}
          description={
            error?.uncertain
              ? "The event is unconfirmed. Retry uses the same operation."
              : "Telemetry was accepted, but readings could not be refreshed. Refresh to check the current state."
          }
        />
      )}
      {unresolved && !busy && (
        <Button onClick={() => void run(unresolved, true)}>
          Retry simulation
        </Button>
      )}
    </div>
  );
  return card ? (
    <Card className="form-section" title="Simulation">
      {content}
    </Card>
  ) : (
    content
  );
}

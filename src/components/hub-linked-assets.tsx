import { useState } from "react";
import type { useList } from "@refinedev/core";
import { useQuery } from "@tanstack/react-query";
import { Alert, Skeleton, Table } from "antd";
import {
  resourceMap,
  translated,
  valueOf,
  type RecordData,
} from "../../shared/resources";
import { linkedHubAssetIds } from "../../shared/hub-assets";
import { getSessionEpoch, request } from "../api";
import { useAdmin } from "../context";
import { ErrorNotice, useSharedHubType } from "./fields";
import { useRecordRow } from "./record-row";

const pageSize = 10;
const positiveId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[1-9]\d{0,18}$/.test(value) &&
  BigInt(value) <= 9223372036854775807n;

export function HubLinkedAssets({
  row,
  linkedDevices,
}: {
  row: RecordData;
  linkedDevices: ReturnType<typeof useList<RecordData>>;
}) {
  const { organization, can } = useAdmin();
  const shared = useSharedHubType(row);
  const recordRow = useRecordRow("assets");
  const epoch = getSessionEpoch();
  const hubOrganization = valueOf(row, "IDOrganization");
  const allowed =
    can(resourceMap.assets, "list") &&
    can(resourceMap.assets, "show") &&
    can(resourceMap.devices, "list");
  const sameWorkspace =
    (hubOrganization === "0" || positiveId(hubOrganization)) &&
    (!organization || organization === hubOrganization);
  const sourceReady =
    linkedDevices.query.isSuccess &&
    !linkedDevices.query.isError &&
    !linkedDevices.query.isPlaceholderData;
  const enabled =
    shared && allowed && sameWorkspace && positiveId(row.id) && sourceReady;
  const ids = enabled ? linkedHubAssetIds(row, linkedDevices.result.data) : [];
  const owner = JSON.stringify([epoch, organization, row.id, hubOrganization]);
  const [page, setPage] = useState({ owner, current: 1 });
  const current =
    page.owner === owner
      ? Math.min(page.current, Math.max(1, Math.ceil(ids.length / pageSize)))
      : 1;
  const pageIds = ids.slice((current - 1) * pageSize, current * pageSize);
  const query = useQuery({
    queryKey: [
      "hub-linked-assets",
      epoch,
      organization,
      row.id,
      hubOrganization,
      pageIds,
    ],
    enabled: enabled && pageIds.length > 0,
    meta: { hubLinkedAssets: true, organization },
    retry: false,
    queryFn: async ({ signal }) => {
      const controller = new AbortController();
      const requestSignal = AbortSignal.any([signal, controller.signal]);
      const assets = new Map<string, RecordData>();
      let partial = false;
      let next = 0;
      try {
        await Promise.all(
          Array.from({ length: Math.min(4, pageIds.length) }, async () => {
            while (next < pageIds.length) {
              requestSignal.throwIfAborted();
              const id = pageIds[next++];
              let asset: RecordData;
              try {
                const response = await request<{ data: RecordData }>(
                  `/api/resources/assets/${encodeURIComponent(id)}`,
                  { signal: requestSignal },
                );
                asset = response.data;
              } catch (error) {
                const status = (error as { statusCode?: number } | null)
                  ?.statusCode;
                if (status === 403 || status === 404) {
                  partial = true;
                  continue;
                }
                throw error;
              }
              if (
                !asset ||
                typeof asset !== "object" ||
                Array.isArray(asset) ||
                asset.id !== id ||
                valueOf(asset, "IDAsset") !== id ||
                valueOf(asset, "IDOrganization") !== hubOrganization
              )
                throw new Error("A linked asset could not be verified.");
              assets.set(id, asset);
            }
          }),
        );
        return {
          data: pageIds.flatMap((id) => {
            const asset = assets.get(id);
            return asset ? [asset] : [];
          }),
          partial,
        };
      } catch (error) {
        controller.abort();
        throw error;
      }
    },
  });

  if (!shared) return null;
  if (!allowed)
    return (
      <Alert
        type="info"
        showIcon
        message="You do not have access to linked assets."
      />
    );
  if (!sameWorkspace || !positiveId(row.id))
    return (
      <Alert
        type="warning"
        showIcon
        message="Linked assets are unavailable for this workspace."
      />
    );
  if (linkedDevices.query.isError)
    return (
      <ErrorNotice
        error={linkedDevices.query.error}
        retry={() => void linkedDevices.query.refetch()}
      />
    );
  if (!sourceReady) return <Skeleton active paragraph={{ rows: 3 }} />;

  const visible =
    enabled && query.isSuccess && !query.isError && !query.isPlaceholderData
      ? query.data
      : undefined;
  return (
    <>
      {linkedDevices.result.limited && (
        <Alert
          type="warning"
          showIcon
          className="page-alert"
          message="Linked assets may be incomplete because the device list is limited."
        />
      )}
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      {visible?.partial && (
        <Alert
          type="warning"
          showIcon
          className="page-alert"
          message="Some linked assets on this page are unavailable."
        />
      )}
      <Table<RecordData>
        rowKey="id"
        onRow={recordRow}
        loading={enabled && pageIds.length > 0 && query.isPending}
        dataSource={visible?.data ?? []}
        locale={{
          emptyText: ids.length
            ? "No accessible assets on this page."
            : "No linked assets.",
        }}
        pagination={{
          current,
          pageSize,
          total: ids.length,
          showSizeChanger: false,
          onChange: (nextPage) => setPage({ owner, current: nextPage }),
        }}
        columns={[
          {
            title: "Tag",
            render: (_, asset) => translated(valueOf(asset, "Tag")) || "—",
          },
          {
            title: "Label",
            render: (_, asset) => translated(valueOf(asset, "Label")) || "—",
          },
          {
            title: "ID",
            dataIndex: "id",
            render: (id: string) => (
              <span className="numeric-value">#{id}</span>
            ),
          },
        ]}
        scroll={{ x: 600 }}
      />
    </>
  );
}

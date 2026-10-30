import { useQuery } from "@tanstack/react-query";
import { getSessionEpoch, request } from "../api";
import { useAdmin } from "../context";
import type {
  CareReportDetail,
  CareReports,
  CareSeries,
  CareSubject,
  CareSubjects,
  CareTrends,
} from "../../shared/care";

export interface CareFailure {
  message: string;
  statusCode?: number;
}
export const validCareId = (id: string | undefined): id is string =>
  !!id && /^[1-9]\d{0,18}$/.test(id) && BigInt(id) <= 9223372036854775807n;
export function careSubjectUrl(subjectId: string, reportId?: string) {
  return `/care/subjects/${encodeURIComponent(subjectId)}${reportId ? `/reports/${encodeURIComponent(reportId)}` : ""}`;
}
const displayDateTime = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
});
export function careDateTime(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not available";
  return displayDateTime.format(new Date(value));
}
export function careDate(value: string | null | undefined) {
  return validCareDate(value)
    ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`
    : "Not available";
}
export function careDisplayTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
function useCareScope() {
  const { identity, organization } = useAdmin();
  return ["care", getSessionEpoch(), identity.id, organization] as const;
}
export function useCareOrganizationTags() {
  const scope = useCareScope();
  return useQuery<
    { organizations: { organizationId: string; tag: string }[] },
    CareFailure
  >({
    queryKey: [...scope, "organization-tags"],
    queryFn: ({ signal }) =>
      request("/api/session/organization-tags", { signal }),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}
export function useCareSubjects(filters: {
  q?: string;
  page?: number;
  size?: number;
  organization?: string;
}) {
  const scope = useCareScope();
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  params.set("page", String(filters.page ?? 1));
  params.set("size", String(filters.size ?? 20));
  if (filters.organization && validCareId(filters.organization))
    params.set("organization", filters.organization);
  const query = params.toString();
  return useQuery<CareSubjects, CareFailure>({
    queryKey: [...scope, "subjects", query],
    queryFn: ({ signal }) => request(`/api/care/subjects?${query}`, { signal }),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}
export interface CareSubjectResponse {
  data: CareSubject;
  reportsAvailable: boolean;
  reportAccess?: "allowed" | "denied";
}
export function useCareSubject(subjectId: string | undefined) {
  const scope = useCareScope();
  return useQuery<CareSubjectResponse, CareFailure>({
    queryKey: [...scope, "subject", subjectId],
    queryFn: ({ signal }) =>
      request(`/api/care/subjects/${subjectId}`, { signal }),
    enabled: validCareId(subjectId),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}
export function useCareReport(
  subjectId: string | undefined,
  reportId: string | undefined,
) {
  const scope = useCareScope();
  return useQuery<{ data: CareReportDetail }, CareFailure>({
    queryKey: [...scope, "report", subjectId, reportId],
    queryFn: ({ signal }) =>
      request(`/api/care/subjects/${subjectId}/reports/${reportId}`, {
        signal,
      }),
    enabled: validCareId(subjectId) && validCareId(reportId),
    staleTime: 300_000,
  });
}
export function validCareDate(
  value: string | undefined | null,
): value is string {
  return (
    !!value &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function careDateOffset(value: string, offset: number) {
  const day = new Date(`${value}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0, 10);
}
export function useCareReports(
  subjectId: string | undefined,
  filters: { startDate?: string; endDate?: string } = {},
) {
  const scope = useCareScope();
  const query = new URLSearchParams(
    Object.entries(filters).filter(
      (entry): entry is [string, string] => !!entry[1],
    ),
  ).toString();
  return useQuery<CareReports, CareFailure>({
    queryKey: [...scope, "reports", subjectId, query],
    queryFn: ({ signal }) =>
      request(
        `/api/care/subjects/${subjectId}/reports${query ? `?${query}` : ""}`,
        { signal },
      ),
    enabled: validCareId(subjectId),
    staleTime: 300_000,
  });
}
export function useCareSeries(
  subjectId: string | undefined,
  reportId: string | undefined,
  range: { start?: string; end?: string; maxPoints?: number } = {},
) {
  const scope = useCareScope();
  const params = new URLSearchParams();
  if (range.start) params.set("start", range.start);
  if (range.end) params.set("end", range.end);
  if (range.maxPoints) params.set("maxPoints", String(range.maxPoints));
  const query = params.toString();
  return useQuery<{ data: CareSeries }, CareFailure>({
    queryKey: [...scope, "series", subjectId, reportId, query],
    queryFn: ({ signal }) =>
      request(
        `/api/care/subjects/${subjectId}/reports/${reportId}/series${query ? `?${query}` : ""}`,
        { signal },
      ),
    enabled: validCareId(subjectId) && validCareId(reportId),
    staleTime: 300_000,
  });
}
export function useCareTrends(
  subjectId: string | undefined,
  filters: {
    days?: 7 | 30;
    startDate?: string;
    endDate?: string;
  },
) {
  const scope = useCareScope();
  const params = new URLSearchParams();
  if (filters.days) params.set("days", String(filters.days));
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  const query = params.toString();
  return useQuery<{ data: CareTrends }, CareFailure>({
    queryKey: [...scope, "trends", subjectId, query],
    queryFn: ({ signal }) =>
      request(`/api/care/subjects/${subjectId}/trends?${query}`, { signal }),
    enabled: validCareId(subjectId),
    staleTime: 300_000,
  });
}

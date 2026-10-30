/** Caregiver wire contracts. IDs remain exact strings; times are UTC ISO instants. */
export interface CarePeriod {
  start: string;
  endExclusive: string;
  timezone: string;
  reportDate: string;
}
export interface CareMetric {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  source: string;
  definition?: string;
}
export interface CareReport {
  id: string;
  subjectId: string;
  period: CarePeriod;
  generatedAt: string | null;
  quality: {
    status: "completed";
    coverage: null;
    flagInvalid: number;
    errorCode: number;
  };
  metrics: CareMetric[];
}
export type BedState = "in_bed" | "out_of_bed" | "unknown";
export interface CareSubject {
  id: string;
  organizationId: string;
  tag: string;
  label: string;
  lastEventAt?: string | null;
  bed: {
    state: "unknown";
    lastObservedState: BedState;
    observedAt: string | null;
    freshness: "unassessed";
    availability?:
      "available" | "unavailable" | "denied" | "ambiguous" | "limited";
    source?: "admin_sensor";
  };
  latestReport: CareReport | null;
}
export interface CareSubjects {
  data: CareSubject[];
  page: number;
  size: number;
  total: number;
  reportsAvailable: boolean;
  limited: boolean;
  reportAccess?: "allowed" | "denied";
}
export interface CareReportDetail extends CareReport {
  provenance: {
    source: "stored_sleepace_report";
    ingestedAt: string | null;
    parsedAt: string | null;
    vendorUpdatedAt?: string | null;
  };
  availableSignals: string[];
}
export interface CareSeries {
  subjectId: string;
  reportId: string;
  period: CarePeriod;
  range: { start: string; endExclusive: string };
  sampling: { intervalSeconds: number | null; limited: boolean };
  points: {
    at: string;
    endExclusive: string;
    heartRate: number | null;
    breathRate: number | null;
    movement: boolean | null;
  }[];
  bedPresence: { start: string; endExclusive: string; state: BedState }[];
  hrv: { at: string; endExclusive: string; value: number | null }[];
  hrvDefinition?: {
    label: string;
    unit: string | null;
    source: string;
    definition: string;
    intervalSeconds?: number;
  };
  temperature: { at: string; endExclusive: string; value: number | null }[];
}
export interface CareReports {
  data: CareReport[];
  reportsAvailable: boolean;
  limited: boolean;
  availability: {
    status: "available" | "no_eligible_reports";
    reason: string | null;
  };
}
export interface CareTrends {
  subjectId: string;
  startDate: string;
  endDate: string;
  timezone: string;
  days: {
    date: string;
    status: "available" | "incomplete" | "unavailable";
    report: CareReport | null;
  }[];
  breathHistory?: {
    source: "daily_report.ahi_count";
    unit: "events/report";
    windowDays: 28;
    cutoff: "exclusive";
    limited: boolean;
    groups: {
      anchorReportId: string;
      startExclusive: string;
      endInclusive: string;
      points: { reportId: string; period: CarePeriod; value: number | null }[];
    }[];
  };
}

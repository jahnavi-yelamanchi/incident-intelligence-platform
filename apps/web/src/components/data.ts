export type IncidentView = {
  id: string;
  reference: string;
  title: string;
  service: string;
  severity: "critical" | "high" | "medium" | "low";
  environment: string;
  ownerName: string | null;
  status: string;
  startedAt: string;
  updatedAt: string;
  timeline: TimelineEntry[];
};

export type TimelineEntry = {
  occurredAt: string;
  type: string;
  title: string;
  detail: string | null;
};

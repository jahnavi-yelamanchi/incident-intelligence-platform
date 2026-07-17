export type IncidentView = {
  id: string;
  reference: string;
  title: string;
  service: string;
  severity: "critical" | "high" | "medium" | "low";
  elapsed: string;
  owner: string;
  status: string;
  latency: string;
  increase: string;
};

export const incidents: IncidentView[] = [
  { id: "checkout", reference: "INC-47291", title: "Checkout API latency", service: "checkout-api", severity: "critical", elapsed: "14m", owner: "Alex Morgan", status: "Investigating", latency: "1,842 ms", increase: "312%" },
  { id: "payments", reference: "INC-47290", title: "Payments error rate", service: "payments-service", severity: "high", elapsed: "28m", owner: "Mina Park", status: "Identified", latency: "980 ms", increase: "184%" },
  { id: "inventory", reference: "INC-47288", title: "Inventory sync delay", service: "inventory-service", severity: "medium", elapsed: "46m", owner: "Jules Reed", status: "Monitoring", latency: "612 ms", increase: "62%" },
  { id: "search", reference: "INC-47284", title: "Search slow queries", service: "search-service", severity: "medium", elapsed: "1h 12m", owner: "Noah Kim", status: "Investigating", latency: "544 ms", increase: "51%" },
  { id: "email", reference: "INC-47279", title: "Email delivery failures", service: "email-service", severity: "low", elapsed: "2h 03m", owner: "Priya Shah", status: "Monitoring", latency: "210 ms", increase: "18%" },
];

export const timeline = [
  { time: "14:31:48", kind: "critical", title: "P95 latency breached threshold", detail: "Current: 1,842 ms · threshold: 1,000 ms" },
  { time: "14:29:12", kind: "critical", title: "Error rate increase detected", detail: "Current: 2.1% · baseline: 0.2%" },
  { time: "14:20:05", kind: "warning", title: "Increasing latency trend detected", detail: "P95 moving average rising" },
  { time: "14:05:08", kind: "info", title: "Deployment checkout-api-2025.05.13.45", detail: "Commit b7f3c9a by sam.developer" },
  { time: "13:47:22", kind: "success", title: "Deployment completed", detail: "All instances healthy" },
  { time: "13:32:01", kind: "info", title: "Incident created", detail: "Alert: checkout API P95 latency high" },
] as const;


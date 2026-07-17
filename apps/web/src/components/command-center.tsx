"use client";

import {
  Activity,
  Bell,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ClipboardCheck,
  FileCode2,
  LayoutDashboard,
  Network,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { parseHiddenPanels, toggleHiddenPanel, type PanelKey } from "../lib/panel-preferences";
import { type IncidentView } from "./data";
import { MarkIcon } from "./icons";

type ApprovalState = "idle" | "review" | "submitting" | "submitted" | "failed";
type HypothesisView = { id: string; statement: string; confidence: number; citations: unknown[]; recommendedChecks: unknown[] };

const navigation = [
  { label: "Command center", icon: LayoutDashboard },
  { label: "Incidents", icon: Activity, active: true },
  { label: "Services", icon: Network },
  { label: "Runbooks", icon: BookOpen },
  { label: "Approvals", icon: ClipboardCheck, count: 3 },
  { label: "Audit", icon: ShieldCheck },
];

export function CommandCenter({ userName, initialIncidents, realtimeToken, realtimeUrl }: { userName: string; initialIncidents: IncidentView[]; realtimeToken: string; realtimeUrl: string }) {
  const [incidents, setIncidents] = useState(initialIncidents);
  const [activeId, setActiveId] = useState(initialIncidents[0]?.id ?? "");
  const [navCompact, setNavCompact] = useState(false);
  const [hiddenPanels, setHiddenPanels] = useState<PanelKey[]>([]);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [approval, setApproval] = useState<ApprovalState>("idle");
  const [liveTick, setLiveTick] = useState(0);
  const [hypotheses, setHypotheses] = useState<HypothesisView[]>([]);

  const active = useMemo(() => incidents.find((incident) => incident.id === activeId) ?? incidents[0], [activeId, incidents]);

  useEffect(() => {
    const stored = window.localStorage.getItem("aegis:hidden-panels");
    queueMicrotask(() => setHiddenPanels(parseHiddenPanels(stored)));
  }, []);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    void fetch(`/api/demo/hypotheses?incidentId=${encodeURIComponent(activeId)}`)
      .then((response) => response.ok ? response.json() as Promise<{ items: HypothesisView[] }> : { items: [] })
      .then((payload) => { if (!cancelled) setHypotheses(payload.items); })
      .catch(() => { if (!cancelled) setHypotheses([]); })
    return () => { cancelled = true; };
  }, [activeId]);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let reconnect: number | undefined;
    let closed = false;
    const connect = () => {
      socket = new WebSocket(realtimeUrl, [`aegis.${realtimeToken}`]);
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as { type?: string; payload?: { items?: IncidentView[] } };
          if (message.type === "incident.snapshot" && Array.isArray(message.payload?.items)) {
            setIncidents(message.payload.items);
            setActiveId((current) => current || message.payload!.items![0]?.id || "");
          }
          if (message.type === "incident.changed") {
            const apiUrl = realtimeUrl.replace(/^ws/, "http").replace(/\/v1\/realtime$/, "/v1/incidents");
            void fetch(apiUrl, { headers: { authorization: `Bearer ${realtimeToken}` } })
              .then((response) => response.ok ? response.json() as Promise<{ items: IncidentView[] }> : null)
              .then((payload) => { if (payload?.items) setIncidents(payload.items); });
          }
        } catch { /* malformed messages are ignored and never affect the active incident */ }
      };
      socket.onclose = () => { if (!closed) reconnect = window.setTimeout(connect, 2_000); };
    };
    connect();
    return () => { closed = true; if (reconnect) window.clearTimeout(reconnect); socket?.close(); };
  }, [realtimeToken, realtimeUrl]);

  useEffect(() => {
    const interval = window.setInterval(() => setLiveTick((value) => value + 1), 8000);
    return () => window.clearInterval(interval);
  }, []);

  function togglePanel(panel: PanelKey) {
    setHiddenPanels((current) => {
      const next = toggleHiddenPanel(current, panel);
      window.localStorage.setItem("aegis:hidden-panels", JSON.stringify(next));
      return next;
    });
  }

  async function submitApproval() {
    const incident = active;
    if (!incident) return;
    setApproval("submitting");
    try {
      const response = await fetch("/api/demo/approval", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ incidentId: incident.id, service: incident.service, environment: incident.environment }),
      });
      if (!response.ok) throw new Error("Approval request was rejected.");
      setApproval("submitted");
    } catch {
      setApproval("failed");
    }
  }

  const incidentsHidden = hiddenPanels.includes("incidents");
  const investigationHidden = hiddenPanels.includes("investigation");

  if (!active) {
    return <main className="app-shell"><section className="workspace"><div className="incident-heading"><h1>No incidents yet</h1><p>Incoming signed alerts will appear here as they are correlated.</p></div></section></main>;
  }

  return (
    <main className={`app-shell ${navCompact ? "nav-compact" : ""} ${incidentsHidden ? "incidents-hidden" : ""} ${investigationHidden ? "investigation-hidden" : ""}`}>
      <aside className="primary-nav">
        <div className="brand" aria-label="Aegis command center">
          <MarkIcon className="brand-mark" />
          <span>Aegis</span>
        </div>
        <nav aria-label="Primary navigation">
          {navigation.map(({ label, icon: Icon, active, count }) => (
            <button className={`nav-item ${active ? "active" : ""}`} key={label} title={navCompact ? label : undefined}>
              <Icon size={19} strokeWidth={1.6} />
              <span>{label}</span>
              {count ? <em>{count}</em> : null}
            </button>
          ))}
        </nav>
        <div className="nav-footer">
          <button className="identity">
            <span className="avatar">AM</span>
            <span><strong>{userName}</strong><small>SRE · On call</small></span>
          </button>
          <button className="collapse-nav" onClick={() => setNavCompact((value) => !value)} aria-label={navCompact ? "Expand navigation" : "Collapse navigation"}>
            <ChevronsLeft size={18} />
            <span>Collapse</span>
          </button>
        </div>
      </aside>

      <header className="topbar">
        <div className="live-state"><span /> Live <small>updated {liveTick === 0 ? "now" : `${liveTick * 8}s ago`}</small></div>
        <div className="top-actions">
          <button className="environment">Production <ChevronDown size={14} /></button>
          <button className="environment">US-East-1 <ChevronDown size={14} /></button>
          <button className="icon-action" aria-label="Search"><Search size={18} /></button>
          <button className="icon-action notification" aria-label="Notifications"><Bell size={18} /><i /></button>
          <a className="profile" href="/auth/profile"><UserRound size={17} /> {userName} <ChevronDown size={13} /></a>
        </div>
      </header>

      {!incidentsHidden && <IncidentRail incidents={incidents} active={active} onSelect={setActiveId} onClose={() => togglePanel("incidents")} />}

      <section className="workspace">
        <div className="incident-heading">
          <div className="heading-line"><span>{active.reference}</span><h1>{active.title}</h1><Severity value={active.severity} /></div>
          <div className="incident-meta">
            <Meta label="Service" value={active.service} />
            <Meta label="Owner" value={active.ownerName ?? "Unassigned"} live />
            <Meta label="Status" value={active.status} />
          </div>
        </div>

        <section className="signal-section" aria-labelledby="latency-heading">
          <div className="section-title"><div><span id="latency-heading">Live evidence</span><strong>{active.timeline.length} events</strong></div><time>Started {relativeTime(active.startedAt)}</time></div>
          <div className="chart-wrap evidence-summary"><strong>{active.service}</strong><span>{active.environment} · last updated {relativeTime(active.updatedAt)}</span></div>
        </section>

        <section className="timeline" aria-labelledby="timeline-heading">
          <div className="section-bar"><h2 id="timeline-heading">Event timeline</h2><button>All events <ChevronDown size={13} /></button></div>
          <ol>
            {active.timeline.map((event, index) => (
              <li key={`${event.occurredAt}-${event.title}`} style={{ "--delay": `${index * 45}ms` } as React.CSSProperties}>
                <time>{new Date(event.occurredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
                <span className={`event-dot ${eventKind(event.type)}`}>{eventKind(event.type) === "success" ? <Check size={12} /> : eventKind(event.type) === "info" ? "i" : "!"}</span>
                <div><strong>{event.title}</strong><small>{event.detail ?? "Evidence received"}</small></div>
              </li>
            ))}
          </ol>
        </section>

        <div className="view-controls">
          <div className="view-menu-wrap">
            <button className="view-options" onClick={() => setViewMenuOpen((value) => !value)} aria-expanded={viewMenuOpen}><SlidersHorizontal size={15} /> View options <ChevronDown size={13} /></button>
            {viewMenuOpen && (
              <div className="view-menu">
                <span>Visible panels</span>
                <label><input type="checkbox" checked={!incidentsHidden} onChange={() => togglePanel("incidents")} /> Incident queue</label>
                <label><input type="checkbox" checked={!investigationHidden} onChange={() => togglePanel("investigation")} /> Investigation</label>
              </div>
            )}
          </div>
          <div className="drawer-tabs">
            {["Service graph", "All evidence", "All hypotheses", "Runbook", "Communications", "Approval details"].map((label) => <button key={label}>{label}</button>)}
          </div>
        </div>
      </section>

      {!investigationHidden && <InvestigationPanel onClose={() => togglePanel("investigation")} hypotheses={hypotheses} />}

      <footer className="action-bar">
        <div><Sparkles size={18} /><span><small>Suggested remediation</small>Increase checkout-api database pool from 50 to 150.</span></div>
        <button className="approval-button" onClick={() => setApproval("review")}>Request approval <ChevronRight size={20} /></button>
      </footer>

      {approval !== "idle" && (
        <ApprovalDialog incident={active} state={approval} onClose={() => setApproval("idle")} onSubmit={submitApproval} />
      )}
    </main>
  );
}

function IncidentRail({ incidents, active, onSelect, onClose }: { incidents: IncidentView[]; active: IncidentView; onSelect: (id: string) => void; onClose: () => void }) {
  return (
    <aside className="incident-rail">
      <div className="rail-title"><h2>Incidents</h2><button onClick={onClose} aria-label="Hide incident queue"><ChevronLeft size={17} /></button></div>
      <div className="incident-list">
        {incidents.map((incident) => (
          <button className={incident.id === active.id ? "selected" : ""} key={incident.id} onClick={() => onSelect(incident.id)}>
            <strong>{incident.title}</strong><span>{incident.service}</span><div><Severity value={incident.severity} /><time>{relativeTime(incident.startedAt)}</time></div>
          </button>
        ))}
      </div>
      <div className="rail-count">Showing {incidents.length} incidents</div>
    </aside>
  );
}

function InvestigationPanel({ onClose, hypotheses }: { onClose: () => void; hypotheses: HypothesisView[] }) {
  const top = hypotheses[0];
  return (
    <aside className="investigation-panel">
      <div className="rail-title"><h2>Investigation</h2><button onClick={onClose} aria-label="Hide investigation"><ChevronRight size={17} /></button></div>
      <section className="hypothesis">
        <span>Top hypothesis</span>
        {top ? <><h3>{top.statement}</h3><p>{Math.round(top.confidence * 100)}% confidence · {top.citations.length} cited source{top.citations.length === 1 ? "" : "s"}</p></> : <><h3>No cited hypothesis yet</h3><p>Index runbooks or service documents, then generate an investigation with a configured provider.</p></>}
      </section>
      <section className="evidence-list">
        <span>Evidence</span>
        <button><Activity size={18} /><span><strong>Live incident evidence</strong><small>Available from the timeline</small></span><ChevronRight size={16} /></button>
        <button><FileCode2 size={18} /><span><strong>Runbook retrieval</strong><small>{top ? `${top.citations.length} cited source${top.citations.length === 1 ? "" : "s"}` : "No cited sources yet"}</small></span><ChevronRight size={16} /></button>
      </section>
      <section className="recommendation">
        <span>Recommended action</span>
        <p>{top ? `${top.recommendedChecks.length} recommended check${top.recommendedChecks.length === 1 ? "" : "s"} available from the cited investigation.` : "Recommendations appear only after evidence retrieval has supporting citations."}</p>
        <button>Inspect action <ChevronRight size={16} /></button>
      </section>
    </aside>
  );
}

function ApprovalDialog({ incident, state, onClose, onSubmit }: { incident: IncidentView; state: ApprovalState; onClose: () => void; onSubmit: () => Promise<void> }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="approval-dialog" role="dialog" aria-modal="true" aria-labelledby="approval-title">
        {state === "submitted" ? (
          <div className="approval-success"><span><Check size={28} /></span><h2 id="approval-title">Approval requested</h2><p>One independent production approver was notified. This action expires in 15 minutes.</p><button onClick={onClose}>Return to incident</button></div>
        ) : (
          <>
            <header><div><span>Human approval gate</span><h2 id="approval-title">Review remediation</h2></div><button onClick={onClose} aria-label="Close"><X size={19} /></button></header>
            <div className="approval-details"><div><span>Action</span><strong>Scale Kubernetes workload</strong></div><div><span>Target</span><strong>{incident.service} / {incident.environment}</strong></div><div><span>Change</span><strong>Scale to 3 replicas</strong></div><div><span>Risk</span><strong>Availability-affecting · preflight required</strong></div></div>
            <div className="policy-pass"><ShieldCheck size={19} /><span><strong>Policy checks passed</strong><small>Requires 1 independent Production Approver confirmation</small></span></div>
            {state === "failed" && <p className="approval-error">Could not create the approval request. Start the local API with `DEMO_MODE=true`.</p>}
            <footer><button className="secondary" onClick={onClose}>Cancel</button><button className="confirm" onClick={() => void onSubmit()} disabled={state === "submitting"}>{state === "submitting" ? <><span className="spinner" /> Sending request</> : <>Send for approval <ChevronRight size={17} /></>}</button></footer>
          </>
        )}
      </section>
    </div>
  );
}

function Severity({ value }: { value: IncidentView["severity"] }) { return <span className={`severity ${value}`}>{value}</span>; }
function Meta({ label, value, live }: { label: string; value: string; live?: boolean }) { return <div className="meta"><span>{label}</span><strong>{value}{live ? <i /> : null}</strong></div>; }
function relativeTime(value: string) { const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000)); return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`; }
function eventKind(type: string) { return type === "alert" ? "critical" : type === "deployment" ? "success" : "info"; }

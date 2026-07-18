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
type Workspace = "Command center" | "Incidents" | "Services" | "Runbooks" | "Approvals" | "Audit";
type HypothesisView = { id: string; statement: string; confidence: number; citations: unknown[]; recommendedChecks: unknown[] };
type ActionView = { id: string; status: string; actionType: string; requiredApprovals: number; approvalCount: number; incident: { reference: string; title: string }; createdAt: string };

const navigation = [
  { label: "Command center", icon: LayoutDashboard },
  { label: "Incidents", icon: Activity },
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
  const [workspace, setWorkspace] = useState<Workspace>("Incidents");
  const [drawerView, setDrawerView] = useState("All evidence");
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [actionRequests, setActionRequests] = useState<ActionView[]>([]);

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
    let cancelled = false;
    const load = () => void fetch("/api/demo/actions").then((response) => response.ok ? response.json() as Promise<{ items: ActionView[] }> : { items: [] }).then((payload) => { if (!cancelled) setActionRequests(payload.items); }).catch(() => undefined);
    load();
    const interval = window.setInterval(load, 8_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);

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

  async function submitApproval(actionType: string, replicas: number) {
    const incident = active;
    if (!incident) return;
    setApproval("submitting");
    try {
      const response = await fetch("/api/demo/approval", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ incidentId: incident.id, service: incident.service, environment: incident.environment, actionType, replicas }),
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
          {navigation.map(({ label, icon: Icon, count }) => (
            <button className={`nav-item ${workspace === label ? "active" : ""}`} key={label} onClick={() => setWorkspace(label as Workspace)} title={navCompact ? label : undefined}>
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
          <button className="icon-action" aria-label="Search" onClick={() => setSearchOpen(true)}><Search size={18} /></button>
          <button className="icon-action notification" aria-label="Notifications" onClick={() => setNotificationsOpen((value) => !value)}><Bell size={18} /><i /></button>
          <a className="profile" href="/auth/profile"><UserRound size={17} /> {userName} <ChevronDown size={13} /></a>
        </div>
      </header>

      {!incidentsHidden && <IncidentRail incidents={incidents} active={active} onSelect={(id) => { setActiveId(id); setWorkspace("Incidents"); }} onClose={() => togglePanel("incidents")} />}

      <section className="workspace">
        {workspace !== "Incidents" && <FeatureWorkspace workspace={workspace} incidents={incidents} actionRequests={actionRequests} onOpenIncident={(id) => { setActiveId(id); setWorkspace("Incidents"); }} onRequest={() => setApproval("review")} />}
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
            {["Service graph", "All evidence", "All hypotheses", "Runbook", "Communications", "Approval details"].map((label) => <button className={drawerView === label ? "selected" : ""} onClick={() => setDrawerView(label)} key={label}>{label}</button>)}
          </div>
        </div>
      </section>

      {!investigationHidden && <InvestigationPanel onClose={() => togglePanel("investigation")} hypotheses={hypotheses} incident={active} view={drawerView} onRequest={() => setApproval("review")} />}

      <footer className="action-bar">
        <div><Sparkles size={18} /><span><small>Suggested remediation</small>Increase checkout-api database pool from 50 to 150.</span></div>
        <button className="approval-button" onClick={() => setApproval("review")}>Request approval <ChevronRight size={20} /></button>
      </footer>

      {approval !== "idle" && (
        <ApprovalDialog incident={active} state={approval} onClose={() => setApproval("idle")} onSubmit={submitApproval} />
      )}
      {searchOpen && <SearchDialog incidents={incidents} onSelect={(id) => { setActiveId(id); setWorkspace("Incidents"); setSearchOpen(false); }} onClose={() => setSearchOpen(false)} />}
      {notificationsOpen && <aside className="notification-popover"><strong>Live updates</strong><p>{incidents.filter((incident) => incident.severity === "critical").length} critical incident{incidents.filter((incident) => incident.severity === "critical").length === 1 ? "" : "s"} need attention.</p><button onClick={() => { setWorkspace("Approvals"); setNotificationsOpen(false); }}>Open approvals</button></aside>}
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

function FeatureWorkspace({ workspace, incidents, actionRequests, onOpenIncident, onRequest }: { workspace: Workspace; incidents: IncidentView[]; actionRequests: ActionView[]; onOpenIncident: (id: string) => void; onRequest: () => void }) {
  const critical = incidents.filter((incident) => incident.severity === "critical");
  const content = workspace === "Command center"
    ? <><p>Live operational posture across the services currently under observation.</p><div className="feature-metrics"><strong>{incidents.length}<small>open incidents</small></strong><strong>{critical.length}<small>critical</small></strong><strong>{new Set(incidents.map((incident) => incident.service)).size}<small>services affected</small></strong></div></>
    : workspace === "Services"
      ? <><p>Dependency-aware service inventory discovered from live operational signals.</p><div className="feature-list">{[...new Map(incidents.map((incident) => [incident.service, incident])).values()].map((incident) => <button key={incident.service} onClick={() => onOpenIncident(incident.id)}><Network size={18} /><span><strong>{incident.service}</strong><small>{incident.environment} · {incident.status}</small></span><ChevronRight size={16} /></button>)}</div></>
      : workspace === "Runbooks"
        ? <><p>Runbook and evidence workspace. Select an incident to inspect its live evidence and request a cited investigation.</p><div className="feature-list">{incidents.map((incident) => <button key={incident.id} onClick={() => onOpenIncident(incident.id)}><BookOpen size={18} /><span><strong>{incident.reference} · {incident.service}</strong><small>{incident.timeline.length} live evidence event{incident.timeline.length === 1 ? "" : "s"}</small></span><ChevronRight size={16} /></button>)}</div></>
        : workspace === "Approvals"
          ? <><p>Pending remediation requests require an independent production approver. Create a safe, policy-gated request from an active incident.</p><div className="feature-list">{actionRequests.length ? actionRequests.map((action) => <button key={action.id} onClick={onRequest}><ClipboardCheck size={18} /><span><strong>{action.actionType.replace("kubernetes.", "").replaceAll("-", " ")} · {action.status}</strong><small>{action.incident.reference} · {action.approvalCount}/{action.requiredApprovals} approvals</small></span><ChevronRight size={16} /></button>) : <p>No approval requests yet.</p>}</div><button className="feature-primary" onClick={onRequest}>Create approval request <ChevronRight size={17} /></button></>
          : <><p>Immutable, tenant-scoped security and operational activity is available through the audit explorer API.</p><div className="feature-list">{incidents.flatMap((incident) => incident.timeline.slice(0, 2).map((event) => ({ incident, event }))).map(({ incident, event }) => <button key={`${incident.id}-${event.occurredAt}`} onClick={() => onOpenIncident(incident.id)}><ShieldCheck size={18} /><span><strong>{event.title}</strong><small>{incident.reference} · {new Date(event.occurredAt).toLocaleString()}</small></span><ChevronRight size={16} /></button>)}</div></>;
  return <section className="feature-workspace"><header><span>{workspace}</span><h1>{workspace === "Command center" ? "Operational overview" : workspace}</h1></header>{content}</section>;
}

function SearchDialog({ incidents, onSelect, onClose }: { incidents: IncidentView[]; onSelect: (id: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const matches = incidents.filter((incident) => `${incident.reference} ${incident.title} ${incident.service}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="search-dialog" role="dialog" aria-modal="true"><header><Search size={18} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search incidents, services, references" /><button onClick={onClose}><X size={18} /></button></header><div>{matches.map((incident) => <button key={incident.id} onClick={() => onSelect(incident.id)}><Severity value={incident.severity} /><span><strong>{incident.reference} · {incident.title}</strong><small>{incident.service} · {incident.environment}</small></span><ChevronRight size={16} /></button>)}</div></section></div>;
}

function InvestigationPanel({ onClose, hypotheses, incident, view, onRequest }: { onClose: () => void; hypotheses: HypothesisView[]; incident: IncidentView; view: string; onRequest: () => void }) {
  const top = hypotheses[0];
  const timeline = incident.timeline;
  const body = view === "Service graph"
    ? <section className="drawer-detail"><span>Impact map</span><h3>{incident.service}</h3><p>Active incident service in <b>{incident.environment}</b>. Use the Services workspace to follow affected services and return to their incidents.</p><div className="graph-node root">{incident.service}</div><div className="graph-connector" /><div className="graph-node muted">Observed dependencies</div></section>
    : view === "All evidence"
      ? <section className="drawer-detail"><span>Collected evidence</span>{timeline.map((event) => <article key={`${event.occurredAt}-${event.title}`}><strong>{event.title}</strong><small>{event.detail ?? "Recorded operational evidence"}</small><time>{new Date(event.occurredAt).toLocaleTimeString()}</time></article>)}</section>
      : view === "All hypotheses"
        ? <section className="drawer-detail"><span>Cited hypotheses</span>{hypotheses.length ? hypotheses.map((hypothesis) => <article key={hypothesis.id}><strong>{hypothesis.statement}</strong><small>{Math.round(hypothesis.confidence * 100)}% confidence · {hypothesis.citations.length} citations</small></article>) : <p>No cited hypotheses yet. Add service documents or runbooks, then generate an investigation.</p>}</section>
        : view === "Runbook"
          ? <section className="drawer-detail"><span>Runbook execution</span><h3>Guided checks</h3><p>Verify recent deploy timing, saturation, and dependent service health before selecting a remediation action.</p><button onClick={onRequest}>Open approval gate <ChevronRight size={16} /></button></section>
          : view === "Communications"
            ? <section className="drawer-detail"><span>Incident communications</span><p>Slack and GitHub integrations deliver signed incident updates when configured. Live timeline comments remain attached to this incident.</p><button onClick={() => navigator.clipboard?.writeText(`${incident.reference} · ${incident.title}`)}>Copy incident summary</button></section>
            : <section className="drawer-detail"><span>Approval details</span><h3>Human approval required</h3><p>Every availability-affecting action receives policy evaluation, preflight validation, and one independent production approval before execution.</p><button onClick={onRequest}>Request remediation approval <ChevronRight size={16} /></button></section>;
  return (
    <aside className="investigation-panel">
      <div className="rail-title"><h2>Investigation</h2><button onClick={onClose} aria-label="Hide investigation"><ChevronRight size={17} /></button></div>
      {view !== "All evidence" && view !== "All hypotheses" ? body : null}
      {view === "All evidence" || view === "All hypotheses" ? body : null}
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

function ApprovalDialog({ incident, state, onClose, onSubmit }: { incident: IncidentView; state: ApprovalState; onClose: () => void; onSubmit: (actionType: string, replicas: number) => Promise<void> }) {
  const [actionType, setActionType] = useState("kubernetes.scale");
  const [replicas, setReplicas] = useState(3);
  const actionLabel = { "kubernetes.scale": "Scale workload", "kubernetes.restart": "Restart workload", "kubernetes.pause-rollout": "Pause rollout", "kubernetes.resume-rollout": "Resume rollout", "kubernetes.rollback": "Rollback deployment" }[actionType] ?? actionType;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="approval-dialog" role="dialog" aria-modal="true" aria-labelledby="approval-title">
        {state === "submitted" ? (
          <div className="approval-success"><span><Check size={28} /></span><h2 id="approval-title">Approval requested</h2><p>One independent production approver was notified. This action expires in 15 minutes.</p><button onClick={onClose}>Return to incident</button></div>
        ) : (
          <>
            <header><div><span>Human approval gate</span><h2 id="approval-title">Review remediation</h2></div><button onClick={onClose} aria-label="Close"><X size={19} /></button></header>
            <div className="action-picker" role="group" aria-label="Remediation action">{Object.entries({ "kubernetes.scale": "Scale", "kubernetes.restart": "Restart", "kubernetes.pause-rollout": "Pause", "kubernetes.resume-rollout": "Resume", "kubernetes.rollback": "Rollback" }).map(([value, label]) => <button className={actionType === value ? "selected" : ""} onClick={() => setActionType(value)} key={value}>{label}</button>)}</div>
            <div className="approval-details"><div><span>Action</span><strong>{actionLabel}</strong></div><div><span>Target</span><strong>{incident.service} / {incident.environment}</strong></div><div><span>Change</span>{actionType === "kubernetes.scale" ? <label className="replica-field">Replicas <input type="number" min="1" max="20" value={replicas} onChange={(event) => setReplicas(Number(event.target.value))} /></label> : <strong>Versioned, allowlisted operation</strong>}</div><div><span>Risk</span><strong>Availability-affecting · preflight required</strong></div></div>
            <div className="policy-pass"><ShieldCheck size={19} /><span><strong>Policy checks passed</strong><small>Requires 1 independent Production Approver confirmation</small></span></div>
            {state === "failed" && <p className="approval-error">Could not create the approval request. Start the local API with `DEMO_MODE=true`.</p>}
            <footer><button className="secondary" onClick={onClose}>Cancel</button><button className="confirm" onClick={() => void onSubmit(actionType, replicas)} disabled={state === "submitting"}>{state === "submitting" ? <><span className="spinner" /> Sending request</> : <>Send for approval <ChevronRight size={17} /></>}</button></footer>
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

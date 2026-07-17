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
import { incidents, timeline, type IncidentView } from "./data";
import { MarkIcon, TrendLine } from "./icons";

type ApprovalState = "idle" | "review" | "submitting" | "submitted";

const navigation = [
  { label: "Command center", icon: LayoutDashboard },
  { label: "Incidents", icon: Activity, active: true },
  { label: "Services", icon: Network },
  { label: "Runbooks", icon: BookOpen },
  { label: "Approvals", icon: ClipboardCheck, count: 3 },
  { label: "Audit", icon: ShieldCheck },
];

export function CommandCenter({ userName }: { userName: string }) {
  const [activeId, setActiveId] = useState(incidents[0]!.id);
  const [navCompact, setNavCompact] = useState(false);
  const [hiddenPanels, setHiddenPanels] = useState<PanelKey[]>([]);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [approval, setApproval] = useState<ApprovalState>("idle");
  const [liveTick, setLiveTick] = useState(0);

  const active = useMemo(
    () => incidents.find((incident) => incident.id === activeId) ?? incidents[0]!,
    [activeId],
  );

  useEffect(() => {
    const stored = window.localStorage.getItem("aegis:hidden-panels");
    queueMicrotask(() => setHiddenPanels(parseHiddenPanels(stored)));
  }, []);

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

  function submitApproval() {
    setApproval("submitting");
    window.setTimeout(() => setApproval("submitted"), 1150);
  }

  const incidentsHidden = hiddenPanels.includes("incidents");
  const investigationHidden = hiddenPanels.includes("investigation");

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

      {!incidentsHidden && <IncidentRail active={active} onSelect={setActiveId} onClose={() => togglePanel("incidents")} />}

      <section className="workspace">
        <div className="incident-heading">
          <div className="heading-line"><span>{active.reference}</span><h1>{active.title}</h1><Severity value={active.severity} /></div>
          <div className="incident-meta">
            <Meta label="Service" value={active.service} />
            <Meta label="Owner" value={active.owner} live />
            <Meta label="Status" value={active.status} />
          </div>
        </div>

        <section className="signal-section" aria-labelledby="latency-heading">
          <div className="section-title"><div><span id="latency-heading">Latency (P95)</span><strong>{active.latency} <small>↑ {active.increase}</small></strong></div><time>Last 1 hour</time></div>
          <div className="chart-wrap"><TrendLine /><div className="chart-axis"><span>13:32</span><span>13:42</span><span>13:52</span><span>14:02</span><span>14:12</span><span>14:22</span><span>14:32</span></div></div>
        </section>

        <section className="timeline" aria-labelledby="timeline-heading">
          <div className="section-bar"><h2 id="timeline-heading">Event timeline</h2><button>All events <ChevronDown size={13} /></button></div>
          <ol>
            {timeline.map((event, index) => (
              <li key={`${event.time}-${event.title}`} style={{ "--delay": `${index * 45}ms` } as React.CSSProperties}>
                <time>{event.time}</time>
                <span className={`event-dot ${event.kind}`}>{event.kind === "success" ? <Check size={12} /> : event.kind === "info" ? "i" : "!"}</span>
                <div><strong>{event.title}</strong><small>{event.detail}</small></div>
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

      {!investigationHidden && <InvestigationPanel onClose={() => togglePanel("investigation")} />}

      <footer className="action-bar">
        <div><Sparkles size={18} /><span><small>Suggested remediation</small>Increase checkout-api database pool from 50 to 150.</span></div>
        <button className="approval-button" onClick={() => setApproval("review")}>Request approval <ChevronRight size={20} /></button>
      </footer>

      {approval !== "idle" && (
        <ApprovalDialog state={approval} onClose={() => setApproval("idle")} onSubmit={submitApproval} />
      )}
    </main>
  );
}

function IncidentRail({ active, onSelect, onClose }: { active: IncidentView; onSelect: (id: string) => void; onClose: () => void }) {
  return (
    <aside className="incident-rail">
      <div className="rail-title"><h2>Incidents</h2><button onClick={onClose} aria-label="Hide incident queue"><ChevronLeft size={17} /></button></div>
      <div className="incident-list">
        {incidents.map((incident) => (
          <button className={incident.id === active.id ? "selected" : ""} key={incident.id} onClick={() => onSelect(incident.id)}>
            <strong>{incident.title}</strong><span>{incident.service}</span><div><Severity value={incident.severity} /><time>{incident.elapsed}</time></div>
          </button>
        ))}
      </div>
      <div className="rail-count">Showing 1–5 of 5</div>
    </aside>
  );
}

function InvestigationPanel({ onClose }: { onClose: () => void }) {
  return (
    <aside className="investigation-panel">
      <div className="rail-title"><h2>Investigation</h2><button onClick={onClose} aria-label="Hide investigation"><ChevronRight size={17} /></button></div>
      <section className="hypothesis">
        <span>Top hypothesis</span>
        <h3>Database connection pool exhaustion</h3>
        <p>Connection wait time increased immediately after the latest deployment.</p>
        <div className="confidence"><span>Confidence</span><strong>71%</strong><i><b /></i></div>
      </section>
      <section className="evidence-list">
        <span>Evidence</span>
        <button><Activity size={18} /><span><strong>Metric graph</strong><small>P95 latency · 14:31:20</small></span><ChevronRight size={16} /></button>
        <button><FileCode2 size={18} /><span><strong>Log excerpt</strong><small>checkout-api · 14:31:18</small></span><ChevronRight size={16} /></button>
      </section>
      <section className="recommendation">
        <span>Recommended action</span>
        <p>Increase <strong>checkout-api</strong> database connection pool max size from 50 to 150.</p>
        <button>Inspect action <ChevronRight size={16} /></button>
      </section>
    </aside>
  );
}

function ApprovalDialog({ state, onClose, onSubmit }: { state: ApprovalState; onClose: () => void; onSubmit: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="approval-dialog" role="dialog" aria-modal="true" aria-labelledby="approval-title">
        {state === "submitted" ? (
          <div className="approval-success"><span><Check size={28} /></span><h2 id="approval-title">Approval requested</h2><p>Two production approvers were notified. This action expires in 15 minutes.</p><button onClick={onClose}>Return to incident</button></div>
        ) : (
          <>
            <header><div><span>Human approval gate</span><h2 id="approval-title">Review remediation</h2></div><button onClick={onClose} aria-label="Close"><X size={19} /></button></header>
            <div className="approval-details"><div><span>Action</span><strong>Scale database connection pool</strong></div><div><span>Target</span><strong>checkout-api / production</strong></div><div><span>Change</span><strong>50 → 150 connections</strong></div><div><span>Risk</span><strong>Low · automatic rollback</strong></div></div>
            <div className="policy-pass"><ShieldCheck size={19} /><span><strong>Policy checks passed</strong><small>Requires 2 Production Approver confirmations</small></span></div>
            <footer><button className="secondary" onClick={onClose}>Cancel</button><button className="confirm" onClick={onSubmit} disabled={state === "submitting"}>{state === "submitting" ? <><span className="spinner" /> Sending request</> : <>Send for approval <ChevronRight size={17} /></>}</button></footer>
          </>
        )}
      </section>
    </div>
  );
}

function Severity({ value }: { value: IncidentView["severity"] }) { return <span className={`severity ${value}`}>{value}</span>; }
function Meta({ label, value, live }: { label: string; value: string; live?: boolean }) { return <div className="meta"><span>{label}</span><strong>{value}{live ? <i /> : null}</strong></div>; }

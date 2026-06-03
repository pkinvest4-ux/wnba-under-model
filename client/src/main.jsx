import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, BarChart3, CalendarDays, RefreshCw, TrendingDown } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import "./styles.css";

const API = import.meta.env.VITE_API_URL || "";

function App() {
  const [today, setToday] = useState({ date: "", picks: [] });
  const [history, setHistory] = useState({ summary: {}, picks: [] });
  const [activeView, setActiveView] = useState("today");
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [trend, setTrend] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [todayRes, historyRes] = await Promise.all([
        fetch(`${API}/picks/today`),
        fetch(`${API}/picks/history`)
      ]);
      if (!todayRes.ok || !historyRes.ok) throw new Error("Unable to load model data");
      setToday(await todayRes.json());
      setHistory(await historyRes.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function openPlayer(playerId) {
    setSelectedPlayer(playerId);
    setTrend(null);
    const res = await fetch(`${API}/players/${playerId}/trend`);
    setTrend(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  const chartRows = useMemo(() => {
    if (!trend?.picks) return [];
    const byDate = new Map();
    for (const pick of trend.picks) {
      if (!byDate.has(pick.game_date)) byDate.set(pick.game_date, { date: formatDate(pick.game_date) });
      byDate.get(pick.game_date)[pick.stat_type] = pick.confidence_score;
    }
    return [...byDate.values()];
  }, [trend]);

  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">WNBA Player Performance</p>
          <h1>Under Model Dashboard <span className="buildTag">Live v2</span></h1>
        </div>
        <button className="iconButton" onClick={load} aria-label="Refresh model data" title="Refresh model data">
          <RefreshCw size={18} />
        </button>
      </header>

      {error && <div className="notice">{error}</div>}

      <section className="metrics">
        <Metric icon={<TrendingDown />} label="Today's Value Unders" value={today.picks?.length || 0} />
        <Metric icon={<Activity />} label="Hit Rate" value={`${history.summary?.hit_rate || 0}%`} />
        <Metric icon={<BarChart3 />} label={`P/L @ ${formatCurrency(history.summary?.unit_size_dollars || 10)}`} value={formatCurrency(history.summary?.estimated_profit_dollars || 0)} />
        <Metric icon={<CalendarDays />} label="Settled Picks" value={history.summary?.settled || 0} />
      </section>

      <section className="workspace">
        <div className="panel picksPanel">
          <div className="panelHeader">
            <div>
              <h2>{activeView === "today" ? "Today's Picks" : "Pick History"}</h2>
              <p>{activeView === "today" ? (today.date ? formatDate(today.date) : "Loading") : historySubtitle(history.summary)}</p>
            </div>
            <div className="segmented" aria-label="Pick view">
              <button className={activeView === "today" ? "active" : ""} onClick={() => setActiveView("today")}>Today</button>
              <button className={activeView === "history" ? "active" : ""} onClick={() => setActiveView("history")}>History</button>
            </div>
          </div>
          <div className="tableWrap">
            {activeView === "today" ? (
              <PickTable
                picks={today.picks || []}
                emptyText="No value unders are flagged for today."
                loading={loading}
                selectedPlayer={selectedPlayer}
                onPlayerClick={openPlayer}
              />
            ) : (
              <HistoryTable
                picks={history.picks || []}
                loading={loading}
                selectedPlayer={selectedPlayer}
                onPlayerClick={openPlayer}
              />
            )}
          </div>
        </div>

        <aside className="panel detailPanel">
          <div className="panelHeader">
            <div>
              <h2>{trend?.player?.name || "Player Drill-Down"}</h2>
              <p>{trend?.player?.team || "Select a player"}</p>
            </div>
          </div>

          {trend ? (
            <>
              <div className="chart">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={chartRows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#dfe3ea" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="points" stroke="#2458a6" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="rebounds" stroke="#a4432f" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="assists" stroke="#247456" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="pra" stroke="#6b4ca6" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <h3>Upcoming Schedule</h3>
              <div className="schedule">
                {trend.upcoming_schedule?.length ? trend.upcoming_schedule.map((game) => (
                  <div key={game.id}>
                    <span>{formatDate(game.game_date)}</span>
                    <strong>{game.status}</strong>
                  </div>
                )) : <p>No upcoming games loaded.</p>}
              </div>
            </>
          ) : (
            <div className="placeholder">
              <BarChart3 size={36} />
              <p>Pick a player to view model history and schedule.</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

function PickTable({ picks, emptyText, loading, selectedPlayer, onPlayerClick }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Player</th>
          <th>Stat Line</th>
          <th>Source</th>
          <th>Model</th>
          <th>Why</th>
          <th>Confidence</th>
          <th>Energy Index</th>
        </tr>
      </thead>
      <tbody>
        {!loading && picks.length === 0 && (
          <tr>
            <td colSpan="7" className="empty">{emptyText}</td>
          </tr>
        )}
        {picks.map((pick) => (
          <tr key={pick.id} onClick={() => onPlayerClick(pick.player_id)} className={selectedPlayer === pick.player_id ? "selected" : ""}>
            <td>
              <strong>{pick.player_name} {pick.starter && <span className="starterBadge">Starter</span>}</strong>
              <span>{pick.team}</span>
            </td>
            <td>{statLabel(pick.stat_type)} under {pick.line}</td>
            <td><SourceBadge pick={pick} /></td>
            <td><ModelBadge version={pick.model_version} /></td>
            <td><ReasonChips reasons={pick.reasons} formula={pick.formula_summary} breakdown={pick.factor_breakdown} /></td>
            <td>
              <div className="score">
                <span>{pick.confidence_score}</span>
                <div><i style={{ width: `${pick.confidence_score}%` }} /></div>
              </div>
            </td>
            <td><Energy value={pick.energy_index} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HistoryTable({ picks, loading, selectedPlayer, onPlayerClick }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Player</th>
          <th>Stat Line</th>
          <th>Result</th>
          <th>Source</th>
          <th>Why</th>
          <th>Confidence</th>
        </tr>
      </thead>
      <tbody>
        {!loading && picks.length === 0 && (
          <tr>
            <td colSpan="7" className="empty">No past picks have been stored yet.</td>
          </tr>
        )}
        {picks.map((pick) => (
          <tr key={pick.id} onClick={() => onPlayerClick(pick.player_id)} className={selectedPlayer === pick.player_id ? "selected" : ""}>
            <td>{formatDate(pick.game_date)}</td>
            <td>
              <strong>{pick.player_name} {pick.starter && <span className="starterBadge">Starter</span>}</strong>
              <span>{pick.team}</span>
            </td>
            <td>{statLabel(pick.stat_type)} under {pick.line}</td>
            <td><OutcomeBadge outcome={pick.outcome} value={pick.result_value} /></td>
            <td><SourceBadge pick={pick} /></td>
            <td><ReasonChips reasons={pick.reasons} formula={pick.formula_summary} breakdown={pick.factor_breakdown} /></td>
            <td>
              <div className="score">
                <span>{pick.confidence_score}</span>
                <div><i style={{ width: `${pick.confidence_score}%` }} /></div>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Metric({ icon, label, value }) {
  return (
    <div className="metric">
      <span>{React.cloneElement(icon, { size: 20 })}</span>
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  );
}

function Energy({ value }) {
  const width = value === "low" ? 28 : value === "medium" ? 58 : 92;
  return (
    <div className={`energy ${value}`}>
      <div><i style={{ width: `${width}%` }} /></div>
      <span>{value}</span>
    </div>
  );
}

function SourceBadge({ pick }) {
  const real = pick.line_source && pick.line_source !== "generated";
  return (
    <span className={`sourceBadge ${real ? "real" : "fallback"}`} title={real ? pick.bookmaker || "Real line" : "Generated model line"}>
      {real ? pick.bookmaker || "Real" : "Model"}
    </span>
  );
}

function ModelBadge({ version }) {
  const learned = version?.startsWith("learned");
  return (
    <span className={`sourceBadge ${learned ? "real" : "fallback"}`} title={version || "fixed_v1"}>
      {learned ? "Learned" : "Fixed"}
    </span>
  );
}

function OutcomeBadge({ outcome, value }) {
  const label = outcome ? outcome : "pending";
  return (
    <span className={`outcomeBadge ${label}`}>
      {label}{value !== null && value !== undefined ? ` ${value}` : ""}
    </span>
  );
}

function ReasonChips({ reasons = [], formula, breakdown = [] }) {
  const title = [
    formula,
    ...breakdown.slice(0, 6).map((item) => `${item.label}: ${item.percent}%`)
  ].filter(Boolean).join("\n");
  return (
    <div className="reasonChips" title={title}>
      {reasons.slice(0, 3).map((reason) => <span key={reason}>{reason}</span>)}
    </div>
  );
}

function statLabel(stat) {
  return stat === "pra" ? "PRA" : stat[0].toUpperCase() + stat.slice(1);
}

function formatDate(date) {
  const [year, month, day] = String(date).slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(year, month - 1, day));
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function historySubtitle(summary = {}) {
  return `${summary.settled || 0} resolved · ${summary.wins || 0}-${summary.losses || 0}-${summary.pushes || 0} · ${summary.voids || 0} void · ${formatCurrency(summary.estimated_profit_dollars || 0)}`;
}

createRoot(document.getElementById("root")).render(<App />);

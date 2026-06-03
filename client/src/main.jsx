import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Clock,
  Filter,
  RefreshCw,
  Search,
  TrendingDown,
  Trophy
} from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import "./styles.css";

const API = import.meta.env.VITE_API_URL || "";
const OUTCOME_FILTERS = ["all", "hit", "miss", "push", "void", "pending"];

function App() {
  const [today, setToday] = useState({ date: "", picks: [] });
  const [history, setHistory] = useState({ summary: {}, picks: [] });
  const [activeView, setActiveView] = useState("today");
  const [historyFilter, setHistoryFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
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

  const todayPicks = today.picks || [];
  const historyPicks = history.picks || [];
  const visibleHistory = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    return historyPicks.filter((pick) => {
      const outcome = pick.outcome || "pending";
      const matchesOutcome = historyFilter === "all" || outcome === historyFilter;
      const matchesSearch = !needle || [pick.player_name, pick.team, pick.stat_type, pick.line_source, pick.bookmaker]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
      return matchesOutcome && matchesSearch;
    });
  }, [historyPicks, historyFilter, searchTerm]);

  const tablePicks = activeView === "today" ? todayPicks : visibleHistory;
  const summary = history.summary || {};
  const topPick = todayPicks[0];
  const realLineCount = todayPicks.filter((pick) => pick.line_source && pick.line_source !== "generated").length;
  const highConfidenceCount = todayPicks.filter((pick) => Number(pick.confidence_score) >= 80).length;

  const chartRows = useMemo(() => {
    if (!trend?.picks) return [];
    const byDate = new Map();
    for (const pick of trend.picks) {
      if (!byDate.has(pick.game_date)) byDate.set(pick.game_date, { date: formatDate(pick.game_date) });
      byDate.get(pick.game_date)[pick.stat_type] = pick.confidence_score;
    }
    return [...byDate.values()];
  }, [trend]);

  const playerRecord = useMemo(() => {
    const picks = trend?.picks || [];
    return {
      hit: picks.filter((pick) => pick.outcome === "hit").length,
      miss: picks.filter((pick) => pick.outcome === "miss").length,
      pending: picks.filter((pick) => !pick.outcome).length
    };
  }, [trend]);

  return (
    <main className="appShell">
      <header className="topbar">
        <div className="titleBlock">
          <p className="eyebrow">WNBA Player Performance</p>
          <h1>Under Model Dashboard</h1>
          <div className="statusRow">
            <span className="liveDot" /> Live model
            <span>{today.date ? formatDate(today.date) : "Loading"}</span>
            <span>{formatJuice(summary.assumed_juice || -115)} assumed juice</span>
          </div>
        </div>
        <button className="iconButton" onClick={load} aria-label="Refresh model data" title="Refresh model data">
          <RefreshCw size={18} />
        </button>
      </header>

      {error && <div className="notice">{error}</div>}

      <section className="overviewBand">
        <div>
          <p className="sectionLabel">Current Card</p>
          <h2>{todayPicks.length} value unders</h2>
          <span>{highConfidenceCount} at 80+ confidence · {realLineCount} real-line matches</span>
        </div>
        {topPick ? (
          <div className="spotlight">
            <span>Top signal</span>
            <strong>{topPick.player_name}</strong>
            <p>{statLabel(topPick.stat_type)} under {topPick.line} · {topPick.confidence_score} confidence</p>
          </div>
        ) : (
          <div className="spotlight muted">
            <span>Top signal</span>
            <strong>No active card</strong>
            <p>Waiting for the next model run.</p>
          </div>
        )}
      </section>

      <section className="metrics">
        <Metric icon={<TrendingDown />} label="Today's Value Unders" value={todayPicks.length} detail={`${highConfidenceCount} high confidence`} />
        <Metric icon={<Trophy />} label="Hit Rate" value={`${summary.hit_rate || 0}%`} detail={`${summary.wins || 0}-${summary.losses || 0} graded`} />
        <Metric icon={<CircleDollarSign />} label={`P/L @ ${formatCurrency(summary.unit_size_dollars || 10)}`} value={formatCurrency(summary.estimated_profit_dollars || 0)} detail={`${summary.flat_unit_roi || 0}% ROI at ${formatJuice(summary.assumed_juice || -115)}`} />
        <Metric icon={<CheckCircle2 />} label="Resolved Picks" value={summary.settled || 0} detail={`${summary.voids || 0} void · ${summary.pending || 0} pending`} />
      </section>

      <section className="workspace">
        <div className="panel picksPanel">
          <div className="panelHeader">
            <div>
              <p className="sectionLabel">{activeView === "today" ? "Live Card" : "Results Ledger"}</p>
              <h2>{activeView === "today" ? "Today's Picks" : "Pick History"}</h2>
              <span>{activeView === "today" ? `${todayPicks.length} active rows` : historySubtitle(summary)}</span>
            </div>
            <div className="segmented" aria-label="Pick view">
              <button className={activeView === "today" ? "active" : ""} onClick={() => setActiveView("today")}>Today</button>
              <button className={activeView === "history" ? "active" : ""} onClick={() => setActiveView("history")}>History</button>
            </div>
          </div>

          <div className="toolbar">
            <label className="searchBox">
              <Search size={16} />
              <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search player, team, stat" />
            </label>
            {activeView === "history" && (
              <div className="filterGroup" aria-label="Outcome filter">
                <Filter size={15} />
                {OUTCOME_FILTERS.map((filter) => (
                  <button key={filter} className={historyFilter === filter ? "active" : ""} onClick={() => setHistoryFilter(filter)}>
                    {filter}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="tableWrap">
            {activeView === "today" ? (
              <PickTable
                picks={filterBySearch(todayPicks, searchTerm)}
                emptyText={loading ? "Loading picks..." : "No value unders are flagged for today."}
                selectedPlayer={selectedPlayer}
                onPlayerClick={openPlayer}
              />
            ) : (
              <HistoryTable
                picks={tablePicks}
                loading={loading}
                selectedPlayer={selectedPlayer}
                onPlayerClick={openPlayer}
              />
            )}
          </div>
        </div>

        <aside className="panel detailPanel">
          <div className="panelHeader compact">
            <div>
              <p className="sectionLabel">Player Detail</p>
              <h2>{trend?.player?.name || "No player selected"}</h2>
              <span>{trend?.player?.team || "Click any row"}</span>
            </div>
          </div>

          {trend ? (
            <>
              <div className="playerCard">
                <div>
                  <span className="avatar">{initials(trend.player.name)}</span>
                </div>
                <div>
                  <strong>{trend.player.name}</strong>
                  <p>{trend.player.team} · {trend.player.position || "Roster"}</p>
                </div>
                <div className="miniRecord">
                  <span>{playerRecord.hit}-{playerRecord.miss}</span>
                  <small>{playerRecord.pending} pending</small>
                </div>
              </div>

              <div className="chartHeader">
                <h3>Confidence Trend</h3>
                <div className="legend">
                  <span className="points">Pts</span>
                  <span className="rebounds">Reb</span>
                  <span className="assists">Ast</span>
                  <span className="pra">PRA</span>
                </div>
              </div>
              <div className="chart">
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={chartRows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5eaf0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #d9e0e8" }} />
                    <Line type="monotone" dataKey="points" stroke="#1f5aa6" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="rebounds" stroke="#a94732" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="assists" stroke="#247456" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="pra" stroke="#6b4ca6" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <h3>Upcoming Schedule</h3>
              <div className="schedule">
                {trend.upcoming_schedule?.length ? trend.upcoming_schedule.map((game) => (
                  <div key={game.id}>
                    <span>{formatDate(game.game_date)}</span>
                    <strong>{cleanStatus(game.status)}</strong>
                  </div>
                )) : <p>No upcoming games loaded.</p>}
              </div>
            </>
          ) : (
            <div className="placeholder">
              <Activity size={38} />
              <strong>Player trends appear here</strong>
              <p>Choose a row to inspect confidence history, record, and schedule.</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

function PickTable({ picks, emptyText, selectedPlayer, onPlayerClick }) {
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
        {picks.length === 0 && (
          <tr>
            <td colSpan="7" className="empty">{emptyText}</td>
          </tr>
        )}
        {picks.map((pick) => (
          <tr key={pick.id} onClick={() => onPlayerClick(pick.player_id)} className={selectedPlayer === pick.player_id ? "selected" : ""}>
            <td><PlayerCell pick={pick} /></td>
            <td><LineCell pick={pick} /></td>
            <td><SourceBadge pick={pick} /></td>
            <td><ModelBadge version={pick.model_version} /></td>
            <td><ReasonChips reasons={pick.reasons} formula={pick.formula_summary} breakdown={pick.factor_breakdown} /></td>
            <td><Confidence value={pick.confidence_score} /></td>
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
            <td colSpan="7" className="empty">No matching picks found.</td>
          </tr>
        )}
        {picks.map((pick) => (
          <tr key={pick.id} onClick={() => onPlayerClick(pick.player_id)} className={selectedPlayer === pick.player_id ? "selected" : ""}>
            <td className="dateCell">{formatDate(pick.game_date)}</td>
            <td><PlayerCell pick={pick} /></td>
            <td><LineCell pick={pick} /></td>
            <td><OutcomeBadge outcome={pick.outcome} value={pick.result_value} /></td>
            <td><SourceBadge pick={pick} /></td>
            <td><ReasonChips reasons={pick.reasons} formula={pick.formula_summary} breakdown={pick.factor_breakdown} /></td>
            <td><Confidence value={pick.confidence_score} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PlayerCell({ pick }) {
  return (
    <div className="playerCell">
      <span className="avatar small">{initials(pick.player_name)}</span>
      <div>
        <strong>{pick.player_name} {pick.starter && <span className="starterBadge">Starter</span>}</strong>
        <span>{pick.team || "WNBA"}</span>
      </div>
    </div>
  );
}

function LineCell({ pick }) {
  return (
    <div className="lineCell">
      <span className={`statPill ${pick.stat_type}`}>{statLabel(pick.stat_type)}</span>
      <strong>Under {pick.line}</strong>
    </div>
  );
}

function Metric({ icon, label, value, detail }) {
  return (
    <div className="metric">
      <span>{React.cloneElement(icon, { size: 20 })}</span>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function Confidence({ value }) {
  const score = Number(value || 0);
  const tier = score >= 85 ? "elite" : score >= 75 ? "strong" : "standard";
  return (
    <div className={`confidence ${tier}`}>
      <span>{score}</span>
      <div><i style={{ width: `${score}%` }} /></div>
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
    <span className={`sourceBadge ${learned ? "learned" : "fallback"}`} title={version || "fixed_v1"}>
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
      {(reasons.length ? reasons : ["Model signal"]).slice(0, 3).map((reason) => <span key={reason}>{reason}</span>)}
    </div>
  );
}

function filterBySearch(picks, searchTerm) {
  const needle = searchTerm.trim().toLowerCase();
  if (!needle) return picks;
  return picks.filter((pick) => [pick.player_name, pick.team, pick.stat_type, pick.line_source, pick.bookmaker]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(needle));
}

function statLabel(stat) {
  return stat === "pra" ? "PRA" : stat[0].toUpperCase() + stat.slice(1);
}

function cleanStatus(status) {
  return String(status || "scheduled").replace("STATUS_", "").replaceAll("_", " ").toLowerCase();
}

function initials(name = "") {
  return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "WN";
}

function formatDate(date) {
  const [year, month, day] = String(date).slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(year, month - 1, day));
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatJuice(value) {
  const number = Number(value || -115);
  return number > 0 ? `+${number}` : String(number);
}

function historySubtitle(summary = {}) {
  return `${summary.settled || 0} resolved · ${summary.wins || 0}-${summary.losses || 0}-${summary.pushes || 0} · ${summary.voids || 0} void · ${formatCurrency(summary.estimated_profit_dollars || 0)}`;
}

createRoot(document.getElementById("root")).render(<App />);

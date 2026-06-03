import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Filter,
  RefreshCw,
  RotateCcw,
  Search,
  TrendingDown,
  Trophy
} from "lucide-react";
import "./styles.css";

const API = import.meta.env.VITE_API_URL || "";
const OUTCOME_FILTERS = ["all", "hit", "miss", "push", "void", "pending"];
const EMPTY_FILTERS = {
  outcome: "all",
  stat: "all",
  source: "all",
  model: "all",
  team: "all",
  starter: "all",
  energy: "all",
  minConfidence: 0
};

function App() {
  const [today, setToday] = useState({ date: "", picks: [] });
  const [history, setHistory] = useState({ summary: {}, picks: [] });
  const [activeView, setActiveView] = useState("today");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedPickId, setExpandedPickId] = useState(null);
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

  useEffect(() => {
    load();
  }, []);

  const todayPicks = today.picks || [];
  const historyPicks = history.picks || [];
  const activePicks = activeView === "today" ? todayPicks : historyPicks;
  const summary = history.summary || {};
  const topPick = todayPicks[0];
  const realLineCount = todayPicks.filter(isRealLine).length;
  const highConfidenceCount = todayPicks.filter((pick) => Number(pick.confidence_score) >= 80).length;

  const filterOptions = useMemo(() => buildFilterOptions(activePicks), [activePicks]);
  const visiblePicks = useMemo(() => applyFilters(activePicks, filters, searchTerm, activeView), [activePicks, filters, searchTerm, activeView]);
  const activeFilterCount = countActiveFilters(filters, searchTerm, activeView);

  function setFilter(key, value) {
    setExpandedPickId(null);
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function resetFilters() {
    setExpandedPickId(null);
    setSearchTerm("");
    setFilters(EMPTY_FILTERS);
  }

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

      <section className="workspace fullWidth">
        <div className="panel picksPanel">
          <div className="panelHeader">
            <div>
              <p className="sectionLabel">{activeView === "today" ? "Live Card" : "Results Ledger"}</p>
              <h2>{activeView === "today" ? "Today's Picks" : "Pick History"}</h2>
              <span>
                {visiblePicks.length} shown · {activeView === "today" ? `${todayPicks.length} active rows` : historySubtitle(summary)}
              </span>
            </div>
            <div className="segmented" aria-label="Pick view">
              <button className={activeView === "today" ? "active" : ""} onClick={() => { setActiveView("today"); setExpandedPickId(null); }}>Today</button>
              <button className={activeView === "history" ? "active" : ""} onClick={() => { setActiveView("history"); setExpandedPickId(null); }}>History</button>
            </div>
          </div>

          <div className="toolbar stacked">
            <div className="toolbarTop">
              <label className="searchBox">
                <Search size={16} />
                <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search player, team, stat, reason" />
              </label>
              <div className="filterMeta">
                <Filter size={15} />
                <span>{activeFilterCount} filters active</span>
                <button className="ghostButton" onClick={resetFilters}><RotateCcw size={14} /> Reset</button>
              </div>
            </div>

            <div className="filterGrid">
              {activeView === "history" && (
                <SegmentedFilter label="Result" value={filters.outcome} options={OUTCOME_FILTERS} onChange={(value) => setFilter("outcome", value)} />
              )}
              <SelectFilter label="Stat" value={filters.stat} options={filterOptions.stats} onChange={(value) => setFilter("stat", value)} />
              <SelectFilter label="Source" value={filters.source} options={filterOptions.sources} onChange={(value) => setFilter("source", value)} />
              <SelectFilter label="Model" value={filters.model} options={filterOptions.models} onChange={(value) => setFilter("model", value)} />
              <SelectFilter label="Team" value={filters.team} options={filterOptions.teams} onChange={(value) => setFilter("team", value)} />
              <SelectFilter label="Starter" value={filters.starter} options={["all", "starter", "bench"]} onChange={(value) => setFilter("starter", value)} />
              <SelectFilter label="Energy" value={filters.energy} options={filterOptions.energy} onChange={(value) => setFilter("energy", value)} />
              <label className="rangeFilter">
                <span>Min Conf</span>
                <strong>{filters.minConfidence}</strong>
                <input type="range" min="0" max="100" step="1" value={filters.minConfidence} onChange={(event) => setFilter("minConfidence", Number(event.target.value))} />
              </label>
            </div>
          </div>

          <div className="tableWrap">
            <PickBoard
              picks={visiblePicks}
              loading={loading}
              activeView={activeView}
              expandedPickId={expandedPickId}
              onToggle={(pickId) => setExpandedPickId((current) => current === pickId ? null : pickId)}
            />
          </div>
        </div>
      </section>
    </main>
  );
}

function PickBoard({ picks, loading, activeView, expandedPickId, onToggle }) {
  const showResult = activeView === "history";
  const colSpan = showResult ? 9 : 8;

  return (
    <table>
      <thead>
        <tr>
          {showResult && <th>Date</th>}
          <th>Player</th>
          <th>Stat Line</th>
          {showResult && <th>Result</th>}
          <th>Source</th>
          <th>Model</th>
          <th>Why</th>
          <th>Confidence</th>
          <th>Energy Index</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
        {!loading && picks.length === 0 && (
          <tr>
            <td colSpan={colSpan} className="empty">No matching picks found.</td>
          </tr>
        )}
        {picks.map((pick) => {
          const expanded = expandedPickId === pick.id;
          return (
            <React.Fragment key={pick.id}>
              <tr className={`${activeView === "history" ? outcomeRowClass(pick.outcome) : ""} ${expanded ? "selected" : ""}`}>
                {showResult && <td className="dateCell">{formatDate(pick.game_date)}</td>}
                <td><PlayerCell pick={pick} /></td>
                <td><LineCell pick={pick} /></td>
                {showResult && <td><OutcomeBadge outcome={pick.outcome} value={pick.result_value} /></td>}
                <td><SourceBadge pick={pick} /></td>
                <td><ModelBadge version={pick.model_version} /></td>
                <td><ReasonChips reasons={pick.reasons} formula={pick.formula_summary} breakdown={pick.factor_breakdown} /></td>
                <td><Confidence value={pick.confidence_score} /></td>
                <td><Energy value={pick.energy_index} /></td>
                <td>
                  <button className="detailsButton" onClick={() => onToggle(pick.id)} aria-label={`${expanded ? "Hide" : "Show"} pick details`}>
                    {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </td>
              </tr>
              {expanded && (
                <tr className="detailRow">
                  <td colSpan={colSpan}>
                    <PickDetails pick={pick} />
                  </td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function PickDetails({ pick }) {
  return (
    <div className="pickDetails">
      <div className="detailSummary">
        <div>
          <p className="sectionLabel">Pick</p>
          <h3>{pick.player_name} · {statLabel(pick.stat_type)} under {pick.line}</h3>
          <span>{formatDate(pick.game_date)} · {pick.team || "WNBA"} · {pick.confidence_score} confidence</span>
        </div>
        <div className="detailBadges">
          <SourceBadge pick={pick} />
          <ModelBadge version={pick.model_version} />
          <OutcomeBadge outcome={pick.outcome} value={pick.result_value} />
        </div>
      </div>

      <div className="detailGrid">
        <DetailStat label="Line Source" value={lineSourceLabel(pick)} />
        <DetailStat label="Odds Price" value={pick.odds_price ?? "n/a"} />
        <DetailStat label="Under Hit Rate" value={formatPercent(pick.under_hit_rate)} />
        <DetailStat label="Recent Minutes" value={formatNumber(pick.recent_minutes_avg)} />
        <DetailStat label="Days Rest" value={pick.days_rest ?? "n/a"} />
        <DetailStat label="Back-to-Back" value={pick.back_to_back ? "Yes" : "No"} />
        <DetailStat label="Opponent Rating" value={formatNumber(pick.opponent_def_rating)} />
        <DetailStat label="Energy Index" value={pick.energy_index || "n/a"} />
      </div>

      <div className="detailColumns">
        <div>
          <p className="detailTitle">Reasons</p>
          <div className="reasonChips expanded">
            {(pick.reasons?.length ? pick.reasons : ["Model signal"]).map((reason) => <span key={reason}>{reason}</span>)}
          </div>
        </div>
        <div>
          <p className="detailTitle">Formula</p>
          <p className="formulaText">{pick.formula_summary || "confidence = model score from weighted player, rest, load, matchup, and historical signals"}</p>
        </div>
      </div>

      {pick.factor_breakdown?.length > 0 && (
        <div>
          <p className="detailTitle">Signal Breakdown</p>
          <div className="breakdownGrid">
            {pick.factor_breakdown.map((item) => (
              <div key={item.label} className="breakdownItem">
                <span>{item.label}</span>
                <strong>{item.percent}%</strong>
                <div><i style={{ width: `${Math.min(100, Math.max(0, Number(item.percent) || 0))}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SelectFilter({ label, value, options, onChange }) {
  return (
    <label className="selectFilter">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option} value={option}>{filterLabel(option)}</option>)}
      </select>
    </label>
  );
}

function SegmentedFilter({ label, value, options, onChange }) {
  return (
    <div className="filterGroup withLabel" aria-label={`${label} filter`}>
      <span>{label}</span>
      {options.map((option) => (
        <button key={option} className={value === option ? "active" : ""} onClick={() => onChange(option)}>
          {option}
        </button>
      ))}
    </div>
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

function DetailStat({ label, value }) {
  return (
    <div className="detailStat">
      <span>{label}</span>
      <strong>{value ?? "n/a"}</strong>
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
  const real = isRealLine(pick);
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

function applyFilters(picks, filters, searchTerm, activeView) {
  const needle = searchTerm.trim().toLowerCase();
  return picks.filter((pick) => {
    const outcome = pick.outcome || "pending";
    if (activeView === "history" && filters.outcome !== "all" && outcome !== filters.outcome) return false;
    if (filters.stat !== "all" && pick.stat_type !== filters.stat) return false;
    if (filters.source !== "all" && sourceKey(pick) !== filters.source) return false;
    if (filters.model !== "all" && modelKey(pick) !== filters.model) return false;
    if (filters.team !== "all" && pick.team !== filters.team) return false;
    if (filters.starter === "starter" && !pick.starter) return false;
    if (filters.starter === "bench" && pick.starter) return false;
    if (filters.energy !== "all" && pick.energy_index !== filters.energy) return false;
    if (Number(pick.confidence_score || 0) < Number(filters.minConfidence || 0)) return false;
    if (!needle) return true;
    return [
      pick.player_name,
      pick.team,
      pick.stat_type,
      pick.line,
      pick.line_source,
      pick.bookmaker,
      pick.model_version,
      pick.energy_index,
      ...(pick.reasons || [])
    ].filter(Boolean).join(" ").toLowerCase().includes(needle);
  });
}

function buildFilterOptions(picks) {
  return {
    stats: ["all", ...uniqueSorted(picks.map((pick) => pick.stat_type))],
    sources: ["all", ...uniqueSorted(picks.map(sourceKey))],
    models: ["all", ...uniqueSorted(picks.map(modelKey))],
    teams: ["all", ...uniqueSorted(picks.map((pick) => pick.team).filter(Boolean))],
    energy: ["all", ...["low", "medium", "high"].filter((band) => picks.some((pick) => pick.energy_index === band))]
  };
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

function countActiveFilters(filters, searchTerm, activeView) {
  let count = searchTerm.trim() ? 1 : 0;
  for (const [key, value] of Object.entries(filters)) {
    if (key === "outcome" && activeView !== "history") continue;
    if (key === "minConfidence") {
      if (Number(value) > 0) count += 1;
    } else if (value !== "all") {
      count += 1;
    }
  }
  return count;
}

function outcomeRowClass(outcome) {
  const label = outcome || "pending";
  return `outcomeRow ${label}`;
}

function isRealLine(pick) {
  return pick.line_source && pick.line_source !== "generated";
}

function sourceKey(pick) {
  return isRealLine(pick) ? "real" : "model";
}

function modelKey(pick) {
  return pick.model_version?.startsWith("learned") ? "learned" : "fixed";
}

function lineSourceLabel(pick) {
  if (!isRealLine(pick)) return "Model fallback";
  return pick.bookmaker ? `${pick.bookmaker} real line` : "Real line";
}

function filterLabel(value) {
  if (value === "all") return "All";
  if (value === "pra") return "PRA";
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statLabel(stat) {
  return stat === "pra" ? "PRA" : stat[0].toUpperCase() + stat.slice(1);
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

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "n/a";
  return Number(value).toFixed(1).replace(/\.0$/, "");
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "n/a";
  const number = Number(value);
  return `${number <= 1 ? Math.round(number * 100) : Math.round(number)}%`;
}

function historySubtitle(summary = {}) {
  return `${summary.settled || 0} resolved · ${summary.wins || 0}-${summary.losses || 0}-${summary.pushes || 0} · ${summary.voids || 0} void · ${formatCurrency(summary.estimated_profit_dollars || 0)}`;
}

createRoot(document.getElementById("root")).render(<App />);

import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Download,
  Filter,
  LineChart,
  RefreshCw,
  RotateCcw,
  Search,
  Star,
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
  lineQuality: "all",
  boardMode: "all",
  riskTag: "all",
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
  const [snapshotsByPickId, setSnapshotsByPickId] = useState({});
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

  async function toggleTrackedBet(pick) {
    const nextTracked = !pick.tracked_bet;
    const res = await fetch(`${API}/picks/${pick.id}/tracked-bet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tracked: nextTracked, stake: summary.unit_size_dollars || 10 })
    });
    if (!res.ok) throw new Error("Unable to update tracked bet");
    updatePickState(pick.id, { tracked_bet: nextTracked, tracked_stake: nextTracked ? summary.unit_size_dollars || 10 : null });
  }

  function updatePickState(pickId, patch) {
    setToday((current) => ({ ...current, picks: (current.picks || []).map((pick) => pick.id === pickId ? { ...pick, ...patch } : pick) }));
    setHistory((current) => ({ ...current, picks: (current.picks || []).map((pick) => pick.id === pickId ? { ...pick, ...patch } : pick) }));
  }

  useEffect(() => {
    load();
  }, []);

  const todayPicks = today.picks || [];
  const historyPicks = history.picks || [];
  const topRecommendedPicks = useMemo(() => buildTopRecommendations(todayPicks), [todayPicks]);
  const activePicks = activeView === "today" ? todayPicks : activeView === "top15" ? topRecommendedPicks : historyPicks;
  const summary = history.summary || {};
  const topPick = todayPicks[0];
  const bestProfile = topRecommendedPicks[0]?.recommendation_profile;
  const realLineCount = todayPicks.filter(isRealLine).length;
  const highConfidenceCount = todayPicks.filter((pick) => Number(pick.confidence_score) >= 80).length;

  const filterOptions = useMemo(() => buildFilterOptions(activePicks), [activePicks]);
  const visiblePicks = useMemo(() => applyFilters(activePicks, filters, searchTerm, activeView), [activePicks, filters, searchTerm, activeView]);
  const analytics = useMemo(() => buildFinancialAnalytics(historyPicks, summary), [historyPicks, summary]);
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

  async function handleTogglePick(pickId) {
    const nextId = expandedPickId === pickId ? null : pickId;
    setExpandedPickId(nextId);
    if (nextId && !snapshotsByPickId[nextId]) {
      try {
        const res = await fetch(`${API}/picks/${nextId}/line-snapshots`);
        if (res.ok) {
          const data = await res.json();
          setSnapshotsByPickId((current) => ({ ...current, [nextId]: data.snapshots || [] }));
        }
      } catch {
        setSnapshotsByPickId((current) => ({ ...current, [nextId]: [] }));
      }
    }
  }

  function exportVisiblePicks() {
    downloadCsv(`${activeView}-picks-${new Date().toISOString().slice(0, 10)}.csv`, visiblePicks);
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
          <span>{highConfidenceCount} at 80+ confidence · {realLineCount} market-tracked lines · {todayPicks.length - realLineCount} signal-only rows</span>
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
              <p className="sectionLabel">{viewLabel(activeView).section}</p>
              <h2>{viewLabel(activeView).title}</h2>
              <span>
                {activeView === "analytics"
                  ? `${analytics.gradedCount} graded · ${formatCurrency(analytics.netProfitDollars)} net`
                  : activeView === "top15"
                    ? `${visiblePicks.length} shown · ${bestProfile ? recommendationSummary(bestProfile) : "waiting for picks"}`
                    : `${visiblePicks.length} shown · ${activeView === "today" ? `${todayPicks.length} active rows` : historySubtitle(summary)}`}
              </span>
            </div>
            <div className="segmented" aria-label="Pick view">
              <button className={activeView === "today" ? "active" : ""} onClick={() => { setActiveView("today"); setExpandedPickId(null); }}>Today</button>
              <button className={activeView === "top15" ? "active" : ""} onClick={() => { setActiveView("top15"); setExpandedPickId(null); }}>Optimized</button>
              <button className={activeView === "history" ? "active" : ""} onClick={() => { setActiveView("history"); setExpandedPickId(null); }}>History</button>
              <button className={activeView === "analytics" ? "active" : ""} onClick={() => { setActiveView("analytics"); setExpandedPickId(null); }}>Analytics</button>
            </div>
          </div>

          {activeView === "analytics" ? (
            <FinancialAnalytics analytics={analytics} summary={summary} />
          ) : (
            <>
              <div className="toolbar stacked">
                <div className="toolbarTop">
                  <label className="searchBox">
                    <Search size={16} />
                    <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search player, team, stat, reason" />
                  </label>
                  <div className="modeBar" aria-label="Board mode">
                    {["all", "bettable", "watchlist", "tracked"].map((mode) => (
                      <button key={mode} className={filters.boardMode === mode ? "active" : ""} onClick={() => setFilter("boardMode", mode)}>
                        {mode === "watchlist" && <Star size={13} />}
                        {filterLabel(mode)}
                      </button>
                    ))}
                  </div>
                  <div className="filterMeta">
                    <Filter size={15} />
                    <span>{activeFilterCount} filters active</span>
                    <button className="ghostButton" onClick={exportVisiblePicks}><Download size={14} /> Export</button>
                    <button className="ghostButton" onClick={resetFilters}><RotateCcw size={14} /> Reset</button>
                  </div>
                </div>

                <div className="filterGrid">
                  {activeView === "history" && (
                    <SegmentedFilter label="Result" value={filters.outcome} options={OUTCOME_FILTERS} onChange={(value) => setFilter("outcome", value)} />
                  )}
                  <SelectFilter label="Stat" value={filters.stat} options={filterOptions.stats} onChange={(value) => setFilter("stat", value)} />
                  <SelectFilter label="Source" value={filters.source} options={filterOptions.sources} onChange={(value) => setFilter("source", value)} />
                  <SelectFilter label="Line Fit" value={filters.lineQuality} options={filterOptions.lineQualities} onChange={(value) => setFilter("lineQuality", value)} />
                  <SelectFilter label="Risk Tag" value={filters.riskTag} options={filterOptions.riskTags} onChange={(value) => setFilter("riskTag", value)} />
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
                  snapshotsByPickId={snapshotsByPickId}
                  onToggle={handleTogglePick}
                  onTrack={toggleTrackedBet}
                />
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function FinancialAnalytics({ analytics, summary }) {
  return (
    <div className="analyticsView">
      <div className="analyticsCards">
        <InsightCard label="Net P/L" value={formatCurrency(analytics.netProfitDollars)} detail={`${analytics.profitUnits.toFixed(2)} units at ${formatJuice(summary.assumed_juice || -115)}`} tone={analytics.netProfitDollars >= 0 ? "positive" : "negative"} />
        <InsightCard label="Best Day" value={analytics.bestDay ? formatCurrency(analytics.bestDay.profitDollars) : "$0"} detail={analytics.bestDay ? `${formatDate(analytics.bestDay.date)} · ${analytics.bestDay.record}` : "No graded days yet"} tone="positive" />
        <InsightCard label="Worst Day" value={analytics.worstDay ? formatCurrency(analytics.worstDay.profitDollars) : "$0"} detail={analytics.worstDay ? `${formatDate(analytics.worstDay.date)} · ${analytics.worstDay.record}` : "No graded days yet"} tone="negative" />
        <InsightCard label="Best Player" value={analytics.topPlayers[0]?.name || "n/a"} detail={analytics.topPlayers[0] ? `${formatCurrency(analytics.topPlayers[0].profitDollars)} · ${analytics.topPlayers[0].record}` : "No graded players yet"} tone="positive" />
        <InsightCard label="Tracked Bets" value={formatCurrency(analytics.tracked.profitDollars)} detail={`${analytics.tracked.record} · ${analytics.tracked.graded} graded`} tone={analytics.tracked.profitDollars >= 0 ? "positive" : "negative"} />
        <InsightCard label="Real-Line Picks" value={`${analytics.marketOnly.hitRate}%`} detail={`${analytics.marketOnly.record} · ${formatCurrency(analytics.marketOnly.profitDollars)}`} tone={analytics.marketOnly.profitDollars >= 0 ? "positive" : "negative"} />
        <InsightCard label="Market-Tracked Slice" value={`${analytics.bettableOnly.hitRate}%`} detail={`${analytics.bettableOnly.record} · ${formatCurrency(analytics.bettableOnly.profitDollars)}`} tone={analytics.bettableOnly.profitDollars >= 0 ? "positive" : "negative"} />
      </div>

      <div className="analyticsGrid">
        <section className="analyticsPanel wide">
          <div className="analyticsHeader">
            <div>
              <p className="sectionLabel">Daily P/L</p>
              <h3>Profit by day</h3>
            </div>
            <span>{analytics.daily.length} days tracked</span>
          </div>
          <DailyProfitChart rows={analytics.daily} maxAbs={analytics.maxDailyAbs} />
        </section>

        <section className="analyticsPanel">
          <div className="analyticsHeader">
            <div>
              <p className="sectionLabel">Cumulative</p>
              <h3>Bankroll curve</h3>
            </div>
            <span>{formatCurrency(analytics.netProfitDollars)}</span>
          </div>
          <CumulativeChart rows={analytics.daily} maxAbs={analytics.maxCumulativeAbs} />
        </section>
      </div>

      <div className="analyticsGrid">
        <Leaderboard title="Most Profitable Players" rows={analytics.topPlayers} positive />
        <Leaderboard title="Biggest Player Drawdowns" rows={analytics.bottomPlayers} />
      </div>

      <div className="analyticsGrid three">
        <SliceTable title="By Stat" rows={analytics.byStat} />
        <SliceTable title="By Source" rows={analytics.bySource} />
        <SliceTable title="By Model" rows={analytics.byModel} />
      </div>

      <div className="analyticsGrid three">
        <SliceTable title="By Line Fit" rows={analytics.byLineFit} />
        <SliceTable title="By Board Status" rows={analytics.byStatus} />
        <SliceTable title="Confidence Calibration" rows={analytics.byConfidence} />
      </div>
    </div>
  );
}

function buildTopRecommendations(picks, limit = 15) {
  const optimized = (picks || [])
    .filter((pick) => pick.optimized_card)
    .sort((a, b) => Number(a.optimized_rank || 999) - Number(b.optimized_rank || 999))
    .map((pick) => ({
      ...pick,
      recommendation_rank: pick.optimized_rank,
      recommendation_score: pick.optimized_score,
      recommendation_profile: {
        projected_hit_rate: null,
        label: pick.optimized_profile || "Shadow optimized card"
      }
    }));
  if (optimized.length) return optimized;

  return (picks || [])
    .filter((pick) => pick.is_value_under !== false)
    .map((pick) => {
      const profile = recommendationProfile(pick);
      const energyScore = energyContributionPercent(pick);
      const score =
        profile.projected_hit_rate * 100 +
        Number(pick.confidence_score || 0) * 4 +
        energyScore * 5 +
        (pick.energy_index === "low" ? 180 : pick.energy_index === "medium" ? 70 : 0) +
        (isRealLine(pick) ? 90 : 0) +
        (pick.stat_type === "assists" ? 45 : 0) +
        (pick.bettable_status === "bettable" ? 60 : 0) -
        (hasRiskTag(pick, "Low sample") ? 250 : 0) -
        (hasRiskTag(pick, "Minutes uncertainty") ? 160 : 0) +
        (hasRiskTag(pick, "Minutes dip") ? 80 : 0) -
        (pick.stat_type === "pra" ? 70 : 0) -
        (pick.stat_type === "rebounds" && Number(pick.line || 0) > 6.5 ? 120 : 0);

      return {
        ...pick,
        recommendation_score: Number(score.toFixed(2)),
        recommendation_profile: profile
      };
    })
    .sort((a, b) => b.recommendation_score - a.recommendation_score || b.confidence_score - a.confidence_score || String(a.player_name).localeCompare(String(b.player_name)))
    .slice(0, limit)
    .map((pick, index) => ({ ...pick, recommendation_rank: index + 1 }));
}

function energyContributionPercent(pick) {
  const energyFactor = (pick.factor_breakdown || []).find((item) => item.label === "Energy Index");
  return Number(energyFactor?.percent || 0);
}

function recommendationProfile(pick) {
  const lowSample = hasRiskTag(pick, "Low sample");
  const minutesUncertainty = hasRiskTag(pick, "Minutes uncertainty");
  const clean = !lowSample && !minutesUncertainty;
  const assists = pick.stat_type === "assists";
  const points = pick.stat_type === "points";
  const rebounds = pick.stat_type === "rebounds";
  const b2b = hasRiskTag(pick, "B2B");
  const confidence = Number(pick.confidence_score || 0);
  const lowerRebound = rebounds && Number(pick.line || 0) <= 6.5;
  const lowEnergy = pick.energy_index === "low" || pick.cycle_window === "low_output_window";
  const peakEnergy = Boolean(pick.fatigue_cycle_peak_window) || Number(pick.fatigue_cycle_peak_score || 0) >= 0.85;
  const energyContribution = energyContributionPercent(pick);

  if (peakEnergy && points && confidence >= 80 && clean) {
    return { projected_hit_rate: 88, label: "Peak Energy points profile" };
  }
  if (peakEnergy && confidence >= 80 && clean) {
    return { projected_hit_rate: 82, label: "Peak Energy profile" };
  }
  if (lowEnergy && confidence >= 80 && clean) {
    return { projected_hit_rate: 70, label: "Low Energy research profile" };
  }
  if (assists && b2b && clean) {
    return { projected_hit_rate: 82, label: "Energy plus B2B profile" };
  }
  if (energyContribution >= 25 && confidence >= 75 && clean) {
    return { projected_hit_rate: 76, label: "Energy-led under profile" };
  }
  if (assists && confidence >= 80 && clean) {
    return { projected_hit_rate: 72, label: "High-confidence assists profile" };
  }
  if (confidence >= 80 && pick.stat_type !== "pra" && (assists || points || lowerRebound) && clean) {
    return { projected_hit_rate: 68, label: "Premium no-PRA profile" };
  }
  if (confidence >= 85 && (assists || points || lowerRebound) && clean) {
    return { projected_hit_rate: 67, label: "Strong confidence profile" };
  }
  if (confidence >= 80 && clean) {
    return { projected_hit_rate: 64, label: "High-confidence research profile" };
  }
  if (lowSample || minutesUncertainty) {
    return { projected_hit_rate: 54, label: lowSample ? "Caution: low sample" : "Caution: minutes uncertainty" };
  }
  return { projected_hit_rate: Math.max(50, Math.min(63, Math.round(Number(pick.confidence_score || 50) * 0.72))), label: "Broad research profile" };
}

function InsightCard({ label, value, detail, tone }) {
  return (
    <div className={`insightCard ${tone || ""}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </div>
  );
}

function DailyProfitChart({ rows, maxAbs }) {
  if (!rows.length) return <div className="emptyAnalytics">No graded days yet.</div>;
  return (
    <div className="dailyChart">
      {rows.map((row) => {
        const height = maxAbs ? Math.max(8, Math.abs(row.profitDollars) / maxAbs * 100) : 8;
        return (
          <div key={row.date} className="dailyBarWrap" title={`${formatDate(row.date)}: ${formatCurrency(row.profitDollars)} · ${row.record}`}>
            <span>{formatCurrency(row.profitDollars)}</span>
            <div className="barTrack">
              <i className={row.profitDollars >= 0 ? "up" : "down"} style={{ height: `${height}%` }} />
            </div>
            <small>{shortDate(row.date)}</small>
          </div>
        );
      })}
    </div>
  );
}

function CumulativeChart({ rows, maxAbs }) {
  if (!rows.length) return <div className="emptyAnalytics">No graded picks yet.</div>;
  return (
    <div className="cumulativeList">
      {rows.map((row) => {
        const width = maxAbs ? Math.max(4, Math.abs(row.cumulativeDollars) / maxAbs * 100) : 4;
        return (
          <div key={row.date} className="cumulativeRow">
            <span>{shortDate(row.date)}</span>
            <div><i className={row.cumulativeDollars >= 0 ? "up" : "down"} style={{ width: `${width}%` }} /></div>
            <strong>{formatCurrency(row.cumulativeDollars)}</strong>
          </div>
        );
      })}
    </div>
  );
}

function Leaderboard({ title, rows, positive = false }) {
  return (
    <section className="analyticsPanel">
      <div className="analyticsHeader">
        <div>
          <p className="sectionLabel">Players</p>
          <h3>{title}</h3>
        </div>
      </div>
      <div className="leaderboard">
        {rows.length ? rows.slice(0, 8).map((row, index) => (
          <div key={row.name} className="leaderRow">
            <span className="rank">{index + 1}</span>
            <div>
              <strong>{row.name}</strong>
              <span>{row.record} · {row.graded} graded · {row.hitRate}% hit</span>
            </div>
            <b className={row.profitDollars >= 0 ? "positiveText" : "negativeText"}>{formatCurrency(row.profitDollars)}</b>
          </div>
        )) : <div className="emptyAnalytics">No graded player rows.</div>}
      </div>
    </section>
  );
}

function SliceTable({ title, rows }) {
  return (
    <section className="analyticsPanel">
      <div className="analyticsHeader">
        <div>
          <p className="sectionLabel">Slices</p>
          <h3>{title}</h3>
        </div>
      </div>
      <div className="sliceTable">
        {rows.length ? rows.map((row) => (
          <div key={row.name} className="sliceRow">
            <strong>{filterLabel(row.name)}</strong>
            <span>{row.record} · {row.hitRate}%</span>
            <b className={row.profitDollars >= 0 ? "positiveText" : "negativeText"}>{formatCurrency(row.profitDollars)}</b>
          </div>
        )) : <div className="emptyAnalytics">No graded rows.</div>}
      </div>
    </section>
  );
}

function PickBoard({ picks, loading, activeView, expandedPickId, snapshotsByPickId, onToggle, onTrack }) {
  const showResult = activeView === "history";
  const showRecommendation = activeView === "top15";
  const colSpan = (showResult ? 10 : 9) + (showRecommendation ? 2 : 0);

  return (
    <table>
      <thead>
        <tr>
          {showResult && <th>Date</th>}
          {showRecommendation && <th>Rank</th>}
          <th>Player</th>
          <th>Stat Line</th>
          {showResult && <th>Result</th>}
          {showRecommendation && <th>Projected</th>}
          <th>Source</th>
          <th>Status</th>
          <th>Why</th>
          <th>Confidence</th>
          <th>Energy Index</th>
          <th>Track</th>
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
                {showRecommendation && <td><RankBadge rank={pick.recommendation_rank} /></td>}
                <td><PlayerCell pick={pick} /></td>
                <td><LineCell pick={pick} /></td>
                {showResult && <td><OutcomeBadge outcome={pick.outcome} value={pick.result_value} /></td>}
                {showRecommendation && <td><RecommendationCell profile={pick.recommendation_profile} /></td>}
                <td><SourceBadge pick={pick} /></td>
                <td><StatusStack pick={pick} /></td>
                <td><ReasonChips reasons={pick.reasons} formula={pick.formula_summary} breakdown={pick.factor_breakdown} /></td>
                <td><Confidence value={pick.confidence_score} /></td>
                <td><Energy value={pick.energy_index} /></td>
                <td>
                  <button className={`trackButton ${pick.tracked_bet ? "active" : ""}`} onClick={() => onTrack(pick)} title={pick.tracked_bet ? "Tracked as bet" : "Mark as bet"}>
                    {pick.tracked_bet ? "Tracked" : "Track"}
                  </button>
                </td>
                <td>
                  <button className="detailsButton" onClick={() => onToggle(pick.id)} aria-label={`${expanded ? "Hide" : "Show"} pick details`}>
                    {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </td>
              </tr>
              {expanded && (
                <tr className="detailRow">
                  <td colSpan={colSpan}>
                    <PickDetails pick={pick} snapshots={snapshotsByPickId[pick.id] || []} />
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

function PickDetails({ pick, snapshots = [] }) {
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
          <StatusBadge status={pick.bettable_status} />
          <ModelBadge version={pick.model_version} />
          <OutcomeBadge outcome={pick.outcome} value={pick.result_value} />
        </div>
      </div>

      <div className="detailGrid">
        <DetailStat label="Line Source" value={lineSourceLabel(pick)} />
        <DetailStat label="Line Fit" value={filterLabel(pick.line_match_quality || "model_only")} />
        <DetailStat label="Model Est." value={pick.estimated_line ?? "n/a"} />
        <DetailStat label="Real Line" value={pick.real_line ?? "n/a"} />
        <DetailStat label="Line Gap" value={pick.line_gap ?? "n/a"} />
        <DetailStat label="Board Status" value={filterLabel(pick.bettable_status || "research")} />
        {pick.recommendation_profile && <DetailStat label="Card Profile" value={recommendationSummary(pick.recommendation_profile)} />}
        <DetailStat label="Energy Window" value={energyWindowLabel(pick.cycle_window)} />
        <DetailStat label="Availability" value={pick.availability_tags?.length ? pick.availability_tags.join(", ") : "Clear"} />
        <DetailStat label="Closing Line" value={pick.closing_line ?? "pending"} />
        <DetailStat label="Closing Source" value={pick.closing_line_source ? filterLabel(sourceKey({ line_source: pick.closing_line_source })) : "pending"} />
        <DetailStat label="Odds Price" value={pick.odds_price ?? "n/a"} />
        <DetailStat label="Recent Minutes" value={formatNumber(pick.recent_minutes_avg)} />
        <DetailStat label="Normal Minutes" value={formatNumber(pick.season_minutes_avg)} />
        <DetailStat label="Days Rest" value={pick.days_rest ?? "n/a"} />
        <DetailStat label="Back-to-Back" value={pick.back_to_back ? "Yes" : "No"} />
        <DetailStat label="Opponent Rating" value={formatNumber(pick.opponent_def_rating)} />
        <DetailStat label="Tracked Bet" value={pick.tracked_bet ? "Yes" : "No"} />
      </div>

      <div className="detailColumns">
        <div>
          <p className="detailTitle">Reasons</p>
          <div className="reasonChips expanded">
            {[...(pick.line_alerts || []), ...(pick.reasons?.length ? pick.reasons : ["Model signal"])].map((reason) => <span key={reason}>{reason}</span>)}
          </div>
        </div>
        <div>
          <p className="detailTitle">Risk Tags</p>
          <div className="reasonChips expanded risk">
            {(pick.risk_tags?.length ? pick.risk_tags : ["No major risk tag"]).map((tag) => <span key={tag}>{tag}</span>)}
          </div>
          <p className="watchlistText">{pick.recommendation_profile?.label || pick.watchlist_reason || "Stored as a research signal for later optimization."}</p>
        </div>
      </div>

      <div className="detailColumns">
        <LineMovement snapshots={snapshots} />
        <div>
          <p className="detailTitle">Formula</p>
          <p className="formulaText">{pick.formula_summary || "confidence = model score from weighted player, rest, load, matchup, and historical signals"}</p>
          {!isRealLine(pick) && <p className="marketWarning">Model-estimated line. Confirm the sportsbook line before treating this as bettable.</p>}
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

function LineMovement({ snapshots }) {
  const first = snapshots[0];
  const latest = snapshots[snapshots.length - 1];
  const delta = first && latest ? Number((Number(latest.observed_line) - Number(first.observed_line)).toFixed(2)) : 0;
  const label = !snapshots.length ? "No snapshots yet" : delta === 0 ? "No movement" : delta > 0 ? `Up ${delta}` : `Down ${Math.abs(delta)}`;

  return (
    <div>
      <p className="detailTitle">Line Movement</p>
      <div className="movementPanel">
        <strong>{label}</strong>
        <span>
          {snapshots.length
            ? `${snapshots.length} snapshots · first ${first.observed_line} · latest ${latest.observed_line}`
            : "Refreshes will store line checks here."}
        </span>
      </div>
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

function RankBadge({ rank }) {
  return <span className="rankBadge">#{rank || "-"}</span>;
}

function RecommendationCell({ profile }) {
  if (!profile) return <span className="projection muted">n/a</span>;
  return (
    <div className="projection">
      <strong>{profile.projected_hit_rate == null ? "Shadow" : `${profile.projected_hit_rate}%`}</strong>
      <span>{profile.label}</span>
    </div>
  );
}

function recommendationSummary(profile) {
  if (!profile) return "waiting for picks";
  return profile.projected_hit_rate == null ? profile.label : `${profile.projected_hit_rate}% top profile`;
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
      {real ? "Real Line" : "Model Est."}
    </span>
  );
}

function StatusStack({ pick }) {
  return (
    <div className="statusStack">
      <StatusBadge status={pick.bettable_status} />
      <ModelBadge version={pick.model_version} />
    </div>
  );
}

function StatusBadge({ status = "research" }) {
  return <span className={`statusBadge ${status}`}>{filterLabel(status)}</span>;
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
    if (activeView !== "top15" && filters.boardMode === "bettable" && pick.bettable_status !== "bettable") return false;
    if (activeView !== "top15" && filters.boardMode === "watchlist" && pick.bettable_status !== "watchlist") return false;
    if (activeView !== "top15" && filters.boardMode === "tracked" && !pick.tracked_bet) return false;
    if (filters.stat !== "all" && pick.stat_type !== filters.stat) return false;
    if (filters.source !== "all" && sourceKey(pick) !== filters.source) return false;
    if (filters.lineQuality !== "all" && (pick.line_match_quality || "model_only") !== filters.lineQuality) return false;
    if (filters.riskTag !== "all" && !(pick.risk_tags || []).includes(filters.riskTag)) return false;
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
      pick.bettable_status,
      pick.watchlist_reason,
      pick.recommendation_profile?.label,
      pick.energy_index,
      ...(pick.reasons || []),
      ...(pick.risk_tags || [])
    ].filter(Boolean).join(" ").toLowerCase().includes(needle);
  });
}

function buildFilterOptions(picks) {
  return {
    stats: ["all", ...uniqueSorted(picks.map((pick) => pick.stat_type))],
    sources: ["all", ...uniqueSorted(picks.map(sourceKey))],
    lineQualities: ["all", ...uniqueSorted(picks.map((pick) => pick.line_match_quality || "model_only"))],
    riskTags: ["all", ...uniqueSorted(picks.flatMap((pick) => pick.risk_tags || []))],
    models: ["all", ...uniqueSorted(picks.map(modelKey))],
    teams: ["all", ...uniqueSorted(picks.map((pick) => pick.team).filter(Boolean))],
    energy: ["all", ...["low", "medium", "high"].filter((band) => picks.some((pick) => pick.energy_index === band))]
  };
}

function buildFinancialAnalytics(picks, summary = {}) {
  const unitSize = Number(summary.unit_size_dollars || 10);
  const winProfitUnits = payoutFromJuice(summary.assumed_juice || -115);
  const graded = picks.filter((pick) => pick.outcome === "hit" || pick.outcome === "miss");
  const dailyMap = new Map();
  const playerMap = new Map();
  const statMap = new Map();
  const sourceMap = new Map();
  const modelMap = new Map();
  const lineFitMap = new Map();
  const statusMap = new Map();
  const confidenceMap = new Map();

  for (const pick of graded) {
    const profitUnits = pickProfitUnits(pick, winProfitUnits);
    const profitDollars = profitUnits * unitSize;
    addAggregate(dailyMap, pick.game_date, pick, profitUnits, profitDollars);
    addAggregate(playerMap, pick.player_name || "Unknown Player", pick, profitUnits, profitDollars);
    addAggregate(statMap, pick.stat_type, pick, profitUnits, profitDollars);
    addAggregate(sourceMap, sourceKey(pick), pick, profitUnits, profitDollars);
    addAggregate(modelMap, modelKey(pick), pick, profitUnits, profitDollars);
    addAggregate(lineFitMap, pick.line_match_quality || "model_only", pick, profitUnits, profitDollars);
    addAggregate(statusMap, pick.bettable_status || "research", pick, profitUnits, profitDollars);
    addAggregate(confidenceMap, confidenceBucket(pick.confidence_score), pick, profitUnits, profitDollars);
  }

  let cumulativeUnits = 0;
  const daily = [...dailyMap.values()]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((row) => {
      cumulativeUnits += row.profitUnits;
      return {
        ...finalizeAggregate(row),
        cumulativeUnits: Number(cumulativeUnits.toFixed(2)),
        cumulativeDollars: Number((cumulativeUnits * unitSize).toFixed(2))
      };
    });

  const players = [...playerMap.values()].map(finalizeAggregate);
  const byProfitDesc = (a, b) => b.profitDollars - a.profitDollars || b.graded - a.graded;
  const byProfitAsc = (a, b) => a.profitDollars - b.profitDollars || b.graded - a.graded;
  const topPlayers = [...players].sort(byProfitDesc);
  const bottomPlayers = [...players].sort(byProfitAsc);
  const byStat = [...statMap.values()].map(finalizeAggregate).sort(byProfitDesc);
  const bySource = [...sourceMap.values()].map(finalizeAggregate).sort(byProfitDesc);
  const byModel = [...modelMap.values()].map(finalizeAggregate).sort(byProfitDesc);
  const byLineFit = [...lineFitMap.values()].map(finalizeAggregate).sort(byProfitDesc);
  const byStatus = [...statusMap.values()].map(finalizeAggregate).sort(byProfitDesc);
  const byConfidence = [...confidenceMap.values()].map(finalizeAggregate).sort((a, b) => confidenceSortValue(a.name) - confidenceSortValue(b.name));
  const netProfitUnits = graded.reduce((total, pick) => total + pickProfitUnits(pick, winProfitUnits), 0);
  const tracked = finalizeAggregate(graded.filter((pick) => pick.tracked_bet).reduce((row, pick) => {
    const units = pickProfitUnits(pick, winProfitUnits);
    row.wins += pick.outcome === "hit" ? 1 : 0;
    row.losses += pick.outcome === "miss" ? 1 : 0;
    row.graded += 1;
    row.profitUnits += units;
    row.profitDollars += units * Number(pick.tracked_stake || unitSize);
    return row;
  }, { name: "tracked", wins: 0, losses: 0, graded: 0, profitUnits: 0, profitDollars: 0 }));
  const marketOnly = aggregatePickList(graded.filter(isRealLine), winProfitUnits, unitSize, "real-line");
  const bettableOnly = aggregatePickList(graded.filter((pick) => pick.bettable_status === "bettable"), winProfitUnits, unitSize, "bettable");

  return {
    gradedCount: graded.length,
    profitUnits: Number(netProfitUnits.toFixed(2)),
    netProfitDollars: Number((netProfitUnits * unitSize).toFixed(2)),
    daily,
    bestDay: daily.length ? [...daily].sort(byProfitDesc)[0] : null,
    worstDay: daily.length ? [...daily].sort(byProfitAsc)[0] : null,
    topPlayers,
    bottomPlayers,
    byStat,
    bySource,
    byModel,
    byLineFit,
    byStatus,
    byConfidence,
    tracked,
    marketOnly,
    bettableOnly,
    maxDailyAbs: Math.max(1, ...daily.map((row) => Math.abs(row.profitDollars))),
    maxCumulativeAbs: Math.max(1, ...daily.map((row) => Math.abs(row.cumulativeDollars)))
  };
}

function addAggregate(map, key, pick, profitUnits, profitDollars) {
  if (!map.has(key)) {
    map.set(key, {
      name: key,
      date: key,
      wins: 0,
      losses: 0,
      graded: 0,
      profitUnits: 0,
      profitDollars: 0
    });
  }
  const row = map.get(key);
  row.graded += 1;
  row.wins += pick.outcome === "hit" ? 1 : 0;
  row.losses += pick.outcome === "miss" ? 1 : 0;
  row.profitUnits += profitUnits;
  row.profitDollars += profitDollars;
}

function aggregatePickList(picks, winProfitUnits, unitSize, name) {
  const row = picks.reduce((current, pick) => {
    const units = pickProfitUnits(pick, winProfitUnits);
    current.wins += pick.outcome === "hit" ? 1 : 0;
    current.losses += pick.outcome === "miss" ? 1 : 0;
    current.graded += 1;
    current.profitUnits += units;
    current.profitDollars += units * unitSize;
    return current;
  }, { name, wins: 0, losses: 0, graded: 0, profitUnits: 0, profitDollars: 0 });
  return finalizeAggregate(row);
}

function finalizeAggregate(row) {
  const wins = row.wins || 0;
  const losses = row.losses || 0;
  const graded = row.graded || wins + losses;
  return {
    ...row,
    wins,
    losses,
    graded,
    profitUnits: Number(row.profitUnits.toFixed(2)),
    profitDollars: Number(row.profitDollars.toFixed(2)),
    hitRate: graded ? Number(((wins / graded) * 100).toFixed(1)) : 0,
    record: `${wins}-${losses}`
  };
}

function confidenceBucket(value) {
  const score = Number(value || 0);
  if (score >= 90) return "90+";
  if (score >= 85) return "85-89";
  if (score >= 80) return "80-84";
  if (score >= 75) return "75-79";
  if (score >= 70) return "70-74";
  if (score >= 65) return "65-69";
  return "<65";
}

function confidenceSortValue(bucket) {
  if (bucket === "<65") return 0;
  if (bucket === "90+") return 90;
  return Number(String(bucket).split("-")[0]) || 0;
}

function pickProfitUnits(pick, winProfitUnits) {
  if (pick.outcome === "hit") return winProfitUnits;
  if (pick.outcome === "miss") return -1;
  return 0;
}

function payoutFromJuice(juice) {
  const number = Math.abs(Number(juice || -115));
  return number >= 100 ? 100 / number : number / 100;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

function viewLabel(view) {
  if (view === "top15") return { section: "Shadow Card", title: "Optimized Plays" };
  if (view === "history") return { section: "Results Ledger", title: "Pick History" };
  if (view === "analytics") return { section: "Financials", title: "Financial Breakdown" };
  return { section: "Live Card", title: "Today's Picks" };
}

function hasRiskTag(pick, tag) {
  return (pick.risk_tags || []).includes(tag);
}

function countActiveFilters(filters, searchTerm, activeView) {
  let count = searchTerm.trim() ? 1 : 0;
  for (const [key, value] of Object.entries(filters)) {
    if (key === "outcome" && activeView !== "history") continue;
    if (key === "boardMode" && activeView === "top15") continue;
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
  if (!isRealLine(pick)) return "Model estimate, not confirmed market line";
  return pick.bookmaker ? `${pick.bookmaker} real line` : "Real line";
}

function energyWindowLabel(value) {
  if (value === "low_output_window") return "Low Energy";
  if (value === "neutral_window") return "Neutral";
  if (value === "strong_output_window") return "High Energy";
  return "n/a";
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

function shortDate(date) {
  const [year, month, day] = String(date).slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric" }).format(new Date(year, month - 1, day));
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

function downloadCsv(filename, picks) {
  const columns = [
    "id",
    "game_date",
    "player_name",
    "team",
    "stat_type",
    "line",
    "estimated_line",
    "real_line",
    "line_gap",
    "line_match_quality",
    "line_source",
    "bettable_status",
    "recommendation_rank",
    "recommendation_score",
    "optimized_card",
    "optimized_rank",
    "optimized_score",
    "optimized_profile",
    "optimized_reasons",
    "recommendation_projected_hit_rate",
    "recommendation_profile",
    "watchlist_reason",
    "confidence_score",
    "energy_index",
    "fatigue_cycle_score",
    "fatigue_cycle_day",
    "fatigue_cycle_offset",
    "fatigue_cycle_confidence",
    "fatigue_cycle_sample_size",
    "fatigue_cycle_down_events",
    "fatigue_cycle_peak_hits",
    "fatigue_cycle_peak_score",
    "fatigue_cycle_peak_window",
    "cycle_window",
    "availability_risk",
    "availability_status",
    "availability_tags",
    "model_version",
    "under_hit_rate",
    "recent_minutes_avg",
    "season_minutes_avg",
    "days_rest",
    "back_to_back",
    "reasons",
    "risk_tags",
    "tracked_bet",
    "closing_line",
    "closing_real_line",
    "closing_line_gap",
    "closing_line_source",
    "closing_bookmaker",
    "closing_odds_price",
    "closing_line_checked_at",
    "outcome",
    "result_value"
  ];
  const rows = [columns.join(",")].concat((picks || []).map((pick) => columns.map((column) => {
    if (column === "recommendation_projected_hit_rate") return csvValue(pick.recommendation_profile?.projected_hit_rate);
    if (column === "recommendation_profile") return csvValue(pick.recommendation_profile?.label);
    return csvValue(Array.isArray(pick[column]) ? pick[column].join("|") : pick[column]);
  }).join(",")));
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvValue(value) {
  if (value === null || value === undefined) return "";
  return `"${String(value).replaceAll('"', '""')}"`;
}

createRoot(document.getElementById("root")).render(<App />);

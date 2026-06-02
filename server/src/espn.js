const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba";
const ESPN_CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/wnba";

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`ESPN ${response.status}: ${await response.text()}`);
  return response.json();
}

function httpsRef(ref) {
  return ref?.replace("http://", "https://");
}

export async function fetchEspnTeams() {
  const payload = await getJson(`${ESPN_SITE}/teams`);
  const teams = payload.sports?.[0]?.leagues?.[0]?.teams || [];
  return teams.map(({ team }) => ({
    external_id: String(team.id),
    city: team.location,
    name: team.name || team.displayName,
    abbreviation: team.abbreviation,
    defensive_rating: 100
  }));
}

export async function fetchEspnPlayers(season) {
  const teamsIndex = await getJson(`${ESPN_CORE}/teams?limit=100`);
  const players = [];
  const seen = new Set();

  for (const teamItem of teamsIndex.items || []) {
    const team = await getJson(httpsRef(teamItem.$ref));
    if (!team.isActive || !team.athletes?.$ref) continue;

    const roster = await getJson(`${httpsRef(team.athletes.$ref)}&limit=100`);
    for (const item of roster.items || []) {
      const athlete = await getJson(httpsRef(item.$ref));
      if (seen.has(String(athlete.id))) continue;
      seen.add(String(athlete.id));

      players.push({
        external_id: String(athlete.id),
        first_name: athlete.firstName || athlete.displayName?.split(" ")[0] || "Unknown",
        last_name: athlete.lastName || athlete.displayName?.split(" ").slice(1).join(" ") || "Player",
        position: athlete.position?.abbreviation || athlete.position?.displayName || null,
        team_external_id: String(team.id),
        roster_status: "roster",
        last_known_starter: false
      });
    }
  }

  return players;
}

export async function fetchEspnGamesByDate(date, season) {
  const compactDate = date.replaceAll("-", "");
  const payload = await getJson(`${ESPN_SITE}/scoreboard?dates=${compactDate}`);
  return (payload.events || []).map((event) => {
    const competitors = event.competitions?.[0]?.competitors || [];
    const home = competitors.find((team) => team.homeAway === "home");
    const away = competitors.find((team) => team.homeAway === "away");
    return {
      external_id: String(event.id),
      date,
      season: event.season?.year || season,
      status: event.status?.type?.name || "scheduled",
      home_team_external_id: home?.team?.id ? String(home.team.id) : null,
      away_team_external_id: away?.team?.id ? String(away.team.id) : null
    };
  });
}

export async function fetchEspnPlayerStatsByDate(date, season) {
  const games = await fetchEspnGamesByDate(date, season);
  const rows = [];

  for (const game of games) {
    const summary = await getJson(`${ESPN_SITE}/summary?event=${game.external_id}`);
    const playersByTeam = summary.boxscore?.players || [];

    for (const teamBlock of playersByTeam) {
      const team = teamBlock.team;
      const statGroup = teamBlock.statistics?.[0];
      if (!team || !statGroup?.athletes) continue;

      for (const athleteRow of statGroup.athletes) {
        if (athleteRow.didNotPlay) continue;
        const stats = Object.fromEntries(statGroup.keys.map((key, index) => [key, athleteRow.stats?.[index]]));
        const homeTeam = summary.header?.competitions?.[0]?.competitors?.find((candidate) => candidate.homeAway === "home")?.team;
        const awayTeam = summary.header?.competitions?.[0]?.competitors?.find((candidate) => candidate.homeAway === "away")?.team;

        rows.push({
          player: {
            id: athleteRow.athlete.id,
            first_name: athleteRow.athlete.displayName?.split(" ")[0],
            last_name: athleteRow.athlete.displayName?.split(" ").slice(1).join(" "),
            position_abbreviation: athleteRow.athlete.position?.abbreviation,
            starter: Boolean(athleteRow.starter)
          },
          team: {
            id: team.id,
            city: team.location,
            name: team.name,
            full_name: team.displayName,
            abbreviation: team.abbreviation
          },
          game: {
            id: game.external_id,
            date: game.date,
            season,
            status: summary.header?.competitions?.[0]?.status?.type?.name || game.status,
            home_team: homeTeam,
            away_team: awayTeam
          },
          min: stats.minutes,
          points: Number(stats.points || 0),
          rebounds: Number(stats.rebounds || 0),
          assists: Number(stats.assists || 0)
        });
      }
    }
  }

  return rows;
}

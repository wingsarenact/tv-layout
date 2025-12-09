import { writeFileSync, mkdirSync } from 'node:fs';
import { XMLParser } from 'fast-xml-parser';
// Using native fetch (Node 18+) - node-fetch causes hanging connections

mkdirSync('data', { recursive: true });

// Timeout wrapper to prevent hanging on unresponsive APIs
function withTimeout(promise, ms = 15000) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Timeout')), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

async function fetchText(url) {
  const res = await withTimeout(fetch(url));
  if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
  return res.text();
}
async function fetchJson(url) {
  const res = await withTimeout(fetch(url));
  if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
  return res.json();
}
function rssTitles(xml) {
  const parser = new XMLParser({ ignoreAttributes: false });
  const obj = parser.parse(xml);
  const items = obj?.rss?.channel?.item || obj?.feed?.entry || [];
  const raw = Array.isArray(items) ? items : [items];
  return raw.map(i => (i?.title?.['#text'] || i?.title || '')).filter(Boolean);
}
function save(path, arr) {
  writeFileSync(path, JSON.stringify(arr.slice(0, 50), null, 0));
}

// Feeds
const FEEDS = [
  { name: 'espn', url: 'https://www.espn.com/espn/rss/news' },
  { name: 'nhl',  url: 'https://www.nhl.com/rss/news' },
  { name: 'fox',  url: 'https://www.foxsports.com/feedout/syndicatedContent?categoryId=0' }
];

for (const f of FEEDS) {
  try {
    const xml = await fetchText(f.url);
    const titles = rssTitles(xml);
    save(`data/news_${f.name}.json`, titles);
  } catch (e) {
    save(`data/news_${f.name}.json`, []);
  }
}

// Scores (today)
const tz = 'America/New_York';
const today = new Date().toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD

// Helper to get yesterday's date
function getYesterday(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
// Helper to get tomorrow's date
function getTomorrow(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function nhlScores() {
  try {
    // New NHL API (api-web.nhle.com) - old statsapi.web.nhl.com is deprecated
    // Query with yesterday's date to ensure we get yesterday's games in the week
    const yesterday = getYesterday(today);
    const tomorrow = getTomorrow(today);
    const js = await fetchJson(`https://api-web.nhle.com/v1/schedule/${yesterday}`);

    // Filter to only yesterday, today, and tomorrow
    const validDates = new Set([yesterday, today, tomorrow]);
    const days = (js.gameWeek || []).filter(day => validDates.has(day.date));
    const games = days.flatMap(day => day.games);

    return games.map(g => {
      const a = g.awayTeam?.abbrev || 'AWAY';
      const h = g.homeTeam?.abbrev || 'HOME';
      const as = g.awayTeam?.score ?? 0;
      const hs = g.homeTeam?.score ?? 0;
      const state = g.gameState || '';
      // Map game states: OFF=Final, LIVE=In Progress, FUT=Scheduled, PRE=Pre-game
      const status = state === 'OFF' ? 'Final' : state === 'LIVE' ? 'Live' : state === 'FUT' ? 'Scheduled' : state;
      return `${a} ${as} @ ${h} ${hs} ${status}`;
    });
  } catch { return []; }
}
async function mlbScores() {
  try {
    const js = await fetchJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}`);
    const games = js.dates?.[0]?.games || [];
    return games.map(g => {
      const a = g.teams.away.team.abbreviation || g.teams.away.team.name;
      const h = g.teams.home.team.abbreviation || g.teams.home.team.name;
      const as = g.teams.away.score ?? 0, hs = g.teams.home.score ?? 0;
      const status = g.status?.detailedState || '';
      return `${a} ${as} @ ${h} ${hs} ${status}`;
    });
  } catch { return []; }
}
async function nbaScores() {
  try {
    const js = await fetchJson('https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json');
    // NBA API structure: games are under scoreboard.games
    const games = js.scoreboard?.games || js.games || [];
    return games.map(g => {
      const a = g.awayTeam?.teamTricode, h = g.homeTeam?.teamTricode;
      const as = g.awayTeam?.score ?? 0, hs = g.homeTeam?.score ?? 0;
      const status = g.gameStatusText || '';
      return `${a} ${as} @ ${h} ${hs} ${status}`;
    });
  } catch { return []; }
}
async function nflScores() {
  try {
    const js = await fetchJson('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
    const events = js.events || [];
    return events.map(ev => {
      const c = ev.competitions?.[0];
      const a = c.competitors.find(t => t.homeAway === 'away');
      const h = c.competitors.find(t => t.homeAway === 'home');
      const status = c.status?.type?.shortDetail || '';
      return `${a.team.abbreviation} ${a.score} @ ${h.team.abbreviation} ${h.score} ${status}`;
    });
  } catch { return []; }
}

const [nhl, mlb, nba, nfl] = await Promise.all([nhlScores(), mlbScores(), nbaScores(), nflScores()]);
save('data/scores_nhl.json', nhl);
save('data/scores_mlb.json', mlb);
save('data/scores_nba.json', nba);
save('data/scores_nfl.json', nfl);
console.log('Feeds and scores updated.');
import { writeFileSync, mkdirSync } from 'node:fs';
import { XMLParser } from 'fast-xml-parser';
// Using native fetch (Node 18+) - node-fetch causes hanging connections

// Optional Cheerio import for HTML fallback (may not be installed)
let cheerio;
try {
  cheerio = await import('cheerio');
} catch {
  cheerio = null;
}

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

// Scores (today) - Using unified ESPN API for all sports
const tz = 'America/New_York';
const today = new Date().toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD

// ESPN API endpoints (reliable, same format for all sports)
const ESPN_ENDPOINTS = {
  nfl: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
  nba: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
  nhl: 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard',
  mlb: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard'
};

// ESPN HTML scoreboard URLs for fallback scraping
const ESPN_HTML_URLS = {
  nfl: 'https://www.espn.com/nfl/scoreboard',
  nba: 'https://www.espn.com/nba/scoreboard',
  nhl: 'https://www.espn.com/nhl/scoreboard',
  mlb: 'https://www.espn.com/mlb/scoreboard'
};

/**
 * Parse ESPN API response into score strings
 */
function parseESPNScores(js) {
  const events = js.events || [];
  return events.map(ev => {
    const c = ev.competitions?.[0];
    if (!c) return null;
    const away = c.competitors.find(t => t.homeAway === 'away');
    const home = c.competitors.find(t => t.homeAway === 'home');
    if (!away || !home) return null;
    const status = c.status?.type?.shortDetail || '';
    return `${away.team.abbreviation} ${away.score} @ ${home.team.abbreviation} ${home.score} ${status}`;
  }).filter(Boolean);
}

/**
 * Fallback: Scrape ESPN HTML scoreboard using Cheerio
 * Returns score strings or empty array if scraping fails
 */
async function scrapeESPNHtml(league) {
  if (!cheerio) return [];
  
  try {
    const url = ESPN_HTML_URLS[league];
    const html = await fetchText(url);
    const $ = cheerio.load(html);
    const scores = [];
    
    // ESPN uses ScoreboardScoreCell components - look for game containers
    // The structure varies but typically includes team abbreviations and scores
    $('.ScoreboardScoreCell, .scoreboard-page .ScoreCell').each((_, el) => {
      const $el = $(el);
      // Try to find team names/abbreviations and scores
      const teams = $el.find('.ScoreCell__TeamName, .Scoreboard__TeamName').map((_, t) => $(t).text().trim()).get();
      const scoreVals = $el.find('.ScoreCell__Score, .Scoreboard__Score').map((_, s) => $(s).text().trim()).get();
      
      if (teams.length >= 2 && scoreVals.length >= 2) {
        const statusEl = $el.find('.ScoreCell__Time, .ScoreboardScoreCell__Time').first();
        const status = statusEl.text().trim() || '';
        scores.push(`${teams[0]} ${scoreVals[0]} @ ${teams[1]} ${scoreVals[1]} ${status}`);
      }
    });
    
    return scores;
  } catch {
    return [];
  }
}

/**
 * Unified ESPN score fetcher with HTML fallback
 */
async function fetchESPNScores(league) {
  try {
    // Try ESPN API first
    const url = ESPN_ENDPOINTS[league];
    const js = await fetchJson(url);
    const scores = parseESPNScores(js);
    
    if (scores.length > 0) {
      return scores;
    }
    
    // If API returned no games, try HTML scraping as fallback
    return await scrapeESPNHtml(league);
  } catch {
    // API failed, try HTML scraping as fallback
    return await scrapeESPNHtml(league);
  }
}

// Individual league score functions using unified ESPN API
async function nhlScores() {
  return fetchESPNScores('nhl');
}

async function mlbScores() {
  return fetchESPNScores('mlb');
}

async function nbaScores() {
  return fetchESPNScores('nba');
}

async function nflScores() {
  return fetchESPNScores('nfl');
}

const [nhl, mlb, nba, nfl] = await Promise.all([nhlScores(), mlbScores(), nbaScores(), nflScores()]);
save('data/scores_nhl.json', nhl);
save('data/scores_mlb.json', mlb);
save('data/scores_nba.json', nba);
save('data/scores_nfl.json', nfl);
console.log('Feeds and scores updated.');
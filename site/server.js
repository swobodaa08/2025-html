// server.js
// npm install express node-fetch@2 cheerio cors
const express = require('express');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

/* --------- Utility functions --------- */

// Poisson probability P(k; lambda)
function poisson(k, lambda) {
  return Math.pow(lambda, k) * Math.exp(-lambda) / factorial(k);
}
function factorial(n) {
  if (n <= 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

// Compute match result probabilities using independent Poisson model
function poissonResultProb(lambdaHome, lambdaAway, maxGoals = 6) {
  // compute probability matrix for scores 0..maxGoals
  const prob = { homeWin: 0, draw: 0, awayWin: 0 };
  for (let i = 0; i <= maxGoals; i++) {
    for (let j = 0; j <= maxGoals; j++) {
      const p = poisson(i, lambdaHome) * poisson(j, lambdaAway);
      if (i > j) prob.homeWin += p;
      else if (i === j) prob.draw += p;
      else prob.awayWin += p;
    }
  }
  // residual mass for >maxGoals is ignored (small)
  const sum = prob.homeWin + prob.draw + prob.awayWin;
  return { homeWin: prob.homeWin / sum, draw: prob.draw / sum, awayWin: prob.awayWin / sum };
}

// Convert probs -> decimal odds with margin
function probsToOdds(probs, margin = 0.05) {
  // apply margin by shrinking probabilities proportionally
  const shrunk = {};
  const total = probs.homeWin + probs.draw + probs.awayWin;
  Object.keys(probs).forEach(k => {
    shrunk[k] = (probs[k] / total) * (1 - margin);
  });
  // renormalize
  const ssum = shrunk.homeWin + shrunk.draw + shrunk.awayWin;
  const odds = {
    home: +(1 / (shrunk.homeWin / ssum)).toFixed(2),
    draw: +(1 / (shrunk.draw / ssum)).toFixed(2),
    away: +(1 / (shrunk.awayWin / ssum)).toFixed(2)
  };
  return odds;
}

/* --------- Parsing heuristics --------- */

function parseMatchPage(html, url) {
  const $ = cheerio.load(html);
  const text = $.root().text();

  // 1) Try to get teams & score from obvious elements
  let home = null, away = null, score = null, date = null;

  // heuristics: look for elements that often contain team names and score
  // 1.a: look for element with class containing "score" or "vysledok" etc.
  const scoreElem = $('[class*="score"], [class*="vysledok"], [class*="result"]').first();
  if (scoreElem && scoreElem.text().trim()) {
    score = scoreElem.text().trim();
  }

  // 1.b: try to parse title or h1 for "Team A - Team B" or "Team A : Team B 2:1"
  const title = $('h1').first().text().trim() || $('title').text().trim();
  if (title) {
    // common patterns: "Home - Away 2:1" or "Home : Away (2:1)" or "Home — Away"
    // we'll extract parts by splitting by '-' or '–' or '—' or ' vs ' or ':' (colon between names)
    const titleParts = title.split(/[-–—]| vs | VS | v | V |: /).map(s=>s.trim()).filter(Boolean);
    if (titleParts.length >= 2) {
      // If score is last token like "Team A - Team B 2:1", capture last token if it's a score
      const lastToken = titleParts[titleParts.length - 1];
      if (/^\d+\s*[:\-]\s*\d+$/.test(lastToken)) {
        score = lastToken;
        // team names are earlier tokens (take first two)
        home = titleParts.slice(0, titleParts.length - 1)[0] || null;
        away = titleParts.slice(1, titleParts.length - 1).join(' - ') || null;
      } else {
        // no explicit score in title; set first two as teams
        home = titleParts[0];
        away = titleParts[1];
      }
    }
  }

  // 1.c: Try page-specific selectors (sportnet heuristics)
  // Many sport pages put teams in elements with class "team-left" / "team-right" etc.
  const tLeft = $('[class*="team-left"], [class*="home-team"], .team--home, .domaci').first().text().trim();
  const tRight = $('[class*="team-right"], [class*="away-team"], .team--away, .hostia').first().text().trim();
  if (tLeft && !home) home = tLeft;
  if (tRight && !away) away = tRight;

  // Another heuristic: find links under ".team" anchor tags
  if ((!home || !away)) {
    const teamAnchors = $('a').filter((i, el) => {
      const t = $(el).text().trim();
      // short names (2+ letters) and often link to klub pages
      return t && t.length > 1 && /[A-Za-zÀ-ÿ0-9]/.test(t);
    }).slice(0, 20);
    // try to find two distinct team-like texts close together
    if (teamAnchors.length >= 2 && (!home || !away)) {
      const texts = teamAnchors.map((i, el) => $(el).text().trim()).get();
      // pick first two distinct
      for (let i = 0; i < texts.length && (!home || !away); i++) {
        if (!home) home = texts[i];
        else if (!away && texts[i] !== home) away = texts[i];
      }
    }
  }

  // 2) parse explicit score in page text (pattern like "2:1" or "2 - 1")
  if (!score) {
    const m = text.match(/\b(\d{1,2})\s*[:\-]\s*(\d{1,2})\b/);
    if (m) score = `${m[1]}:${m[2]}`;
  }

  // 3) parse date/time heuristically: find date pattern e.g. dd.mm.yyyy or YYYY-MM-DD
  const mDate = text.match(/\b(\d{1,2}\.\s?\d{1,2}\.\s?\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4})\b/);
  if (mDate) date = mDate[0];

  // 4) extract some simple stats if present: goals for each team this season etc.
  // We'll search for "Góly" or "Goly" followed by number; and "Zápasy" or "Zapasy"
  const stats = {};
  const mHomeGoalsSeason = text.match(/Góly[\s\S]{0,40}?(\d{1,3})/i);
  if (mHomeGoalsSeason) stats.homeGoalsSeason = parseInt(mHomeGoalsSeason[1], 10);
  const mMatches = text.match(/Zápasy[\s\S]{0,40}?(\d{1,4})/i);
  if (mMatches) stats.matches = parseInt(mMatches[1], 10);

  // 5) extract events (goal/minute) if there's an events table or list
  const events = [];
  // look for elements that contain 'min' or a minute mark like "23'" or "23." and have goal/yellow text near
  $('*').each((i, el) => {
    const elText = $(el).text().replace(/\s+/g, ' ').trim();
    const m = elText.match(/\b(\d{1,2})['’]\s*(gól|goal|Góly|Gól|góly|žltá|červená|pen)\b/i);
    if (m) {
      events.push({ minute: parseInt(m[1], 10), raw: elText.slice(0, 200) });
    }
  });

  // 6) prepare parsed object
  const parsed = {
    url,
    teams: { home: home || null, away: away || null },
    score: score || null,
    date: date || null,
    stats,
    events: events.slice(0, 50)
  };

  return parsed;
}

/* --------- Odds estimation logic (heuristic) --------- */

function estimateOddsFromParsed(parsed) {
  // Try to estimate attack/defense strength from parsed.stats (very rough)
  // If we have no numeric stats, fallback to neutral probabilities.

  // default neutral lambdas
  let lambdaHome = 1.2, lambdaAway = 1.0; // expected goals
  let note = [];

  // If page contains "homeGoalsSeason" or matches, try to build goals-per-match
  if (parsed.stats && parsed.stats.homeGoalsSeason && parsed.stats.matches) {
    const gpm = parsed.stats.homeGoalsSeason / Math.max(1, parsed.stats.matches);
    // set home lambda relative to gpm (cap)
    lambdaHome = Math.max(0.3, Math.min(3.5, gpm));
    lambdaAway = Math.max(0.3, Math.min(3.5, gpm * 0.9));
    note.push('Použité sezónne góly pre odhad lambda.');
  } else {
    // If score exists and match already played, infer relative strengths from score
    if (parsed.score) {
      const m = parsed.score.match(/(\d+)\s*[:\-]\s*(\d+)/);
      if (m) {
        const gh = parseInt(m[1], 10), ga = parseInt(m[2], 10);
        // assign lambdas biased by observed goals (but scaled)
        lambdaHome = Math.max(0.2, Math.min(4, 1 + gh * 0.6));
        lambdaAway = Math.max(0.2, Math.min(4, 1 + ga * 0.6));
        note.push('Použité skóre zápasu na hrubý odhad lambda.');
      }
    }
  }

  // Home advantage tweak: if we detect that first team is home (we assume so), add +10%
  // (Many pages list home first)
  lambdaHome *= 1.1;
  note.push('Aplikovaná domácia výhoda (+10%).');

  // Compute Poisson result probabilities
  const probs = poissonResultProb(lambdaHome, lambdaAway, 6);

  // If parsed.events show many goals for one side, bias probabilities
  if (parsed.events && parsed.events.length >= 2) {
    // naive: count appearance of "gól" in event raw strings
    const homeGoalsMention = parsed.events.filter(e => /\b(gól|góly|goal)\b/i.test(e.raw)).length;
    if (homeGoalsMention >= 2) {
      // small boost to home win
      probs.homeWin = Math.min(0.98, probs.homeWin + 0.05);
      if (probs.awayWin > 0.02) probs.awayWin = Math.max(0.01, probs.awayWin - 0.02);
      note.push('Upravene pravdepodobnosti podľa udalostí (goals mention).');
    }
  }

  // Normalize probs
  const total = probs.homeWin + probs.draw + probs.awayWin;
  probs.homeWin /= total; probs.draw /= total; probs.awayWin /= total;

  // Convert to decimal odds with a margin
  const odds = probsToOdds(probs, 0.06); // 6% book margin

  return { probs, odds, lambdaHome: +lambdaHome.toFixed(2), lambdaAway: +lambdaAway.toFixed(2), note };
}

/* --------- API endpoint --------- */

app.get('/api/match', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing ?url= parameter' });

  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; scraper/1.0)' } });
    if (!r.ok) return res.status(502).json({ error: 'Upstream fetch failed', status: r.status });
    const html = await r.text();

    const parsed = parseMatchPage(html, url);
    const estimate = estimateOddsFromParsed(parsed);

    res.json({ source: url, parsed, estimate });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error', detail: err.message });
  }
});

/* --------- Start server --------- */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Match-scraper API listening on ${PORT}`));
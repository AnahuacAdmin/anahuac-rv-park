/*
 * Anahuac RV Park — The Daily Edition (News RSS)
 * Local tab: Chambers County / Anahuac focused with keyword filtering
 * Texas tab: Houston metro + statewide
 * National tab: AP, Reuters, NPR
 */
const router = require('express').Router();
const Parser = require('rss-parser');
const { db } = require('../database');

const parser = new Parser({
  timeout: 8000,
  headers: { 'User-Agent': 'AnahuacRVPark/1.0 (RSS Reader)' }
});

// ── Keyword filters for Chambers County / Anahuac local focus ──

const ANAHUAC_KEYWORDS = [
  // Cities & places
  'anahuac', 'chambers county', 'mont belvieu', 'beach city',
  'cove, tx', 'old river-winfree', 'old river', 'winfree',
  'hankamer', 'stowell', 'winnie', 'hamshire',
  'trinity bay', 'east bay', 'galveston bay',
  'wallisville', 'smith point', 'double bayou',
  // Landmarks
  'anahuac national wildlife refuge', 'trinity river',
  'lake anahuac', 'fort anahuac', 'gatorfest', 'gator fest',
  // Schools & institutions
  'anahuac isd', 'anahuac high school', 'barbers hill',
  'east chambers isd', 'east chambers',
  // Roads
  'fm-563', 'fm 563', 'fm-1985', 'fm 1985', 'fm-562', 'fm 562',
  'sh-146', 'sh 146', 'state highway 146',
];

const REJECT_KEYWORDS = [
  'houston', 'harris county', 'pasadena', 'baytown',
  'spring, tx', 'cypress', 'katy', 'sugar land', 'pearland',
  'the woodlands', 'conroe', 'humble', 'tomball',
  'league city', 'webster', 'clear lake', 'friendswood',
  'missouri city', 'richmond', 'rosenberg',
];

// Strong local identifiers — if present, always allow even with reject keywords
const STRONG_LOCAL = ['anahuac', 'chambers county', 'mont belvieu', 'barbers hill'];

function isLocalToAnahuac(article) {
  var text = ((article.title || '') + ' ' + (article.snippet || '')).toLowerCase();

  var hasLocal = ANAHUAC_KEYWORDS.some(kw => text.includes(kw));
  if (!hasLocal) return false;

  var hasReject = REJECT_KEYWORDS.some(kw => text.includes(kw));
  if (!hasReject) return true;

  // Allow if a strong local keyword is also present
  return STRONG_LOCAL.some(kw => text.includes(kw));
}

// ── Feed definitions ──
// Local: Houston-area stations (filtered for Chambers County mentions)
// + Galveston/coastal sources for bay area relevance
const LOCAL_FEEDS = [
  { name: 'KHOU 11', url: 'https://www.khou.com/feeds/syndication/rss/news/local', filter: true },
  { name: 'KPRC 2', url: 'https://www.click2houston.com/arc/outboundfeeds/rss/category/news/?outputType=xml', filter: true },
  { name: 'ABC13', url: 'https://abc13.com/feed/', filter: true },
  { name: 'Fox 26', url: 'https://www.fox26houston.com/feeds/syndication/rss/news/local', filter: true },
  // Galveston Bay / coastal — more relevant to our area
  { name: 'Galveston Daily News', url: 'https://www.galvnews.com/search/?f=rss&t=article&l=25&s=start_time&sd=desc', filter: false, section: 'coastal' },
];

const TEXAS_FEEDS = [
  // Houston metro (broader stories that don't match local filter)
  { name: 'KHOU 11', url: 'https://www.khou.com/feeds/syndication/rss/news/local', houstonOverflow: true },
  { name: 'ABC13', url: 'https://abc13.com/feed/', houstonOverflow: true },
  // Statewide
  { name: 'Texas Tribune', url: 'https://www.texastribune.org/feeds/articles.rss' },
  { name: 'KHOU Texas', url: 'https://www.khou.com/feeds/syndication/rss/news/texas' },
  { name: 'Texas DPS', url: 'https://www.dps.texas.gov/rss/press-releases.xml' },
];

const NATIONAL_FEEDS = [
  { name: 'AP News', url: 'https://rsshub.app/apnews/topics/apf-topnews' },
  { name: 'Reuters', url: 'https://www.reutersagency.com/feed/?taxonomy=best-topics&post_type=best' },
  { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
];

// In-memory cache with TTL
let _newsCache = { data: null, timestamp: 0 };
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

// ── Public: get news headlines ──
router.get('/headlines', async (req, res) => {
  var now = Date.now();
  var category = req.query.category || 'all';

  // Return cached if fresh
  if (_newsCache.data && now - _newsCache.timestamp < CACHE_TTL) {
    if (category !== 'all' && _newsCache.data[category]) {
      return res.json({ [category]: _newsCache.data[category], updated: _newsCache.timestamp });
    }
    return res.json({ ..._newsCache.data, updated: _newsCache.timestamp });
  }

  // Also check DB cache (survives restart)
  try {
    var cached = db.prepare("SELECT data, expires_at FROM content_cache WHERE cache_key='news_headlines'").get();
    if (cached && new Date(cached.expires_at).getTime() > now) {
      _newsCache = { data: JSON.parse(cached.data), timestamp: now };
      if (category !== 'all' && _newsCache.data[category]) {
        return res.json({ [category]: _newsCache.data[category], updated: _newsCache.timestamp });
      }
      return res.json({ ..._newsCache.data, updated: _newsCache.timestamp });
    }
  } catch {}

  // Fetch fresh from all sources
  var result = { local: [], texas: [], national: [] };

  // ── LOCAL: fetch and filter for Chambers County ──
  var localRaw = [];
  var localPromises = LOCAL_FEEDS.map(source =>
    fetchFeed(source).catch(() => ({ items: [] }))
  );
  var localResults = await Promise.all(localPromises);
  for (var lr of localResults) {
    if (lr.items) localRaw.push(...lr.items.map(item => ({ ...item, _filter: lr._filter, _section: lr._section })));
  }

  // Apply Anahuac keyword filter to filtered sources
  var allLocalItems = [];
  for (var item of localRaw) {
    if (item._filter) {
      if (isLocalToAnahuac(item)) {
        item.section = 'local';
        allLocalItems.push(item);
      }
      // Non-matching items become Texas tab candidates (Houston overflow)
    } else {
      // Unfiltered sources (e.g., Galveston coastal) go straight to local
      item.section = item._section || 'local';
      allLocalItems.push(item);
    }
  }

  // Sort by date, deduplicate by title similarity, limit
  allLocalItems.sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
  result.local = deduplicateNews(allLocalItems).slice(0, 15);

  // Tag local items with subsection for frontend grouping
  result.local.forEach(item => {
    var text = ((item.title || '') + ' ' + (item.snippet || '')).toLowerCase();
    if (text.includes('sheriff') || text.includes('crime') || text.includes('arrest') ||
        text.includes('police') || text.includes('murder') || text.includes('robbery') ||
        text.includes('assault') || text.includes('theft') || text.includes('indict')) {
      item.subsection = 'safety';
    } else if (text.includes('galveston bay') || text.includes('coastal') || text.includes('trinity bay') ||
               text.includes('east bay') || text.includes('fishing') || text.includes('marine') ||
               text.includes('wildlife refuge') || text.includes('boat')) {
      item.subsection = 'coastal';
    } else if (text.includes('isd') || text.includes('school') || text.includes('student') ||
               text.includes('teacher') || text.includes('graduation')) {
      item.subsection = 'schools';
    } else {
      item.subsection = 'news';
    }
  });

  // ── TEXAS: statewide + Houston overflow ──
  var texasRaw = [];
  // Houston overflow: local-feed items that didn't pass the Anahuac filter
  for (var item of localRaw) {
    if (item._filter && !isLocalToAnahuac(item)) {
      texasRaw.push(item);
    }
  }
  // Dedicated Texas feeds
  var texasPromises = TEXAS_FEEDS.filter(s => !s.houstonOverflow).map(source =>
    fetchFeed(source).catch(() => ({ items: [] }))
  );
  var texasResults = await Promise.all(texasPromises);
  for (var tr of texasResults) {
    if (tr.items) texasRaw.push(...tr.items);
  }
  texasRaw.sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
  result.texas = deduplicateNews(texasRaw).slice(0, 12);

  // ── NATIONAL ──
  var natPromises = NATIONAL_FEEDS.map(source =>
    fetchFeed(source).catch(() => ({ items: [] }))
  );
  var natResults = await Promise.all(natPromises);
  for (var nr of natResults) {
    if (nr.items) result.national.push(...nr.items);
  }
  result.national.sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
  result.national = deduplicateNews(result.national).slice(0, 10);

  // Cache in memory and DB
  _newsCache = { data: result, timestamp: now };
  try {
    var expiresAt = new Date(now + CACHE_TTL).toISOString();
    db.prepare("INSERT OR REPLACE INTO content_cache (cache_key, data, expires_at) VALUES (?,?,?)")
      .run('news_headlines', JSON.stringify(result), expiresAt);
  } catch {}

  if (category !== 'all' && result[category]) {
    return res.json({ [category]: result[category], updated: now });
  }
  res.json({ ...result, updated: now });
});

async function fetchFeed(source) {
  var feed = await parser.parseURL(source.url);
  var items = (feed.items || []).slice(0, 10).map(item => ({
    title: (item.title || '').trim(),
    link: item.link || '',
    source: source.name,
    published: item.pubDate || item.isoDate || '',
    snippet: item.contentSnippet ? item.contentSnippet.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
    image: item.enclosure?.url || item['media:content']?.$.url || ''
  }));
  return { items, _filter: source.filter, _section: source.section };
}

// Remove near-duplicate headlines (same title from different sources)
function deduplicateNews(items) {
  var seen = new Set();
  return items.filter(item => {
    var key = (item.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Live TV links (static) ──
router.get('/live-tv', (req, res) => {
  res.json([
    { name: 'KHOU 11', url: 'https://www.khou.com/watch', icon: '📺' },
    { name: 'ABC13', url: 'https://abc13.com/live/', icon: '📺' },
    { name: 'KPRC 2', url: 'https://www.click2houston.com/live/', icon: '📺' },
    { name: 'Fox 26', url: 'https://www.fox26houston.com/live', icon: '📺' },
    { name: 'AP News', url: 'https://apnews.com/live', icon: '🌐' },
    { name: 'White House', url: 'https://www.whitehouse.gov/live/', icon: '🏛️' }
  ]);
});

module.exports = router;

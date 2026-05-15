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
  headers: { 'User-Agent': 'AnahuacRVPark/1.0 (RSS Reader)' },
  customFields: { item: [['source', 'rssSource']] },
});

// ── Date filter: show articles from last 3 days ──
const MAX_ARTICLE_AGE_MS = 72 * 60 * 60 * 1000; // 72 hours (3 days)

function isRecentArticle(article) {
  var pubDate = article.published || article.pubDate || article.isoDate;
  if (!pubDate) return false; // No date = skip

  var articleDate = new Date(pubDate);
  if (isNaN(articleDate.getTime())) return false; // Invalid date = skip

  var ageMs = Date.now() - articleDate.getTime();
  if (ageMs > MAX_ARTICLE_AGE_MS) return false; // Older than 24 hours = skip
  if (ageMs < 0) return false; // Future date = broken feed = skip

  return true;
}

// ── Block real estate and classified-ad content ──
const SOURCE_BLOCKLIST = [
  'realtor.com', 'zillow.com', 'redfin.com', 'trulia.com',
  'homes.com', 'apartments.com', 'rentals.com', 'movoto.com',
  'coldwellbanker.com', 'century21.com', 'remax.com', 'keller williams',
  'har.com', 'loopnet.com',
];

const TITLE_BLOCKLIST = [
  'for sale', 'for rent', 'price reduced', 'new listing',
  'bedroom home', 'bed bath', 'sqft', 'square feet',
  'asking price', 'mls#', 'mls #',
];

function isBlockedContent(article, rawSourceName) {
  // 1. Check extracted publisher name (from Google News title split)
  var sourceLower = (article.source || '').toLowerCase();
  if (SOURCE_BLOCKLIST.some(d => sourceLower.includes(d))) return true;

  // 2. Check RSS <source> element text (Google News publisher field)
  if (rawSourceName) {
    var rawLower = rawSourceName.toLowerCase();
    if (SOURCE_BLOCKLIST.some(d => rawLower.includes(d))) return true;
  }

  // 3. Check link URL hostname (for direct RSS feeds, not Google News redirects)
  try {
    var linkHost = new URL(article.link).hostname.toLowerCase();
    if (SOURCE_BLOCKLIST.some(d => linkHost.includes(d))) return true;
  } catch {}

  // 4. Check title for real-estate-only phrases
  var titleLower = (article.title || '').toLowerCase();
  if (TITLE_BLOCKLIST.some(phrase => titleLower.includes(phrase))) return true;

  return false;
}

// Clear stale news cache on first request after deploy
let _cacheCleared = false;
function clearStaleCacheOnce() {
  if (_cacheCleared) return;
  _cacheCleared = true;
  try {
    db.prepare("DELETE FROM content_cache WHERE cache_key LIKE 'news_%'").run();
    console.log('[news] Cleared stale news cache (first request after deploy)');
  } catch (e) {
    console.log('[news] Cache clear skipped:', e.message);
  }
}

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
  // Additional local identifiers
  'cedar bayou', 'cotton lake', 'lake charlotte',
  'chambers county courthouse', 'anahuac chamber',
  'icu bridge', 'i-10 east',
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
// Local: Google News search-as-RSS (pre-filtered for our area keywords)
// + City of Anahuac WordPress RSS (if available)
const LOCAL_FEEDS = [
  // Priority 100 — Anahuac-specific sources
  { name: 'Google News - Anahuac Texas', url: 'https://news.google.com/rss/search?q=%22Anahuac%22+Texas&hl=en-US&gl=US&ceid=US:en', weight: 100, googleNews: true },
  // Anahuac Progress: no RSS feed available (both domains return 404 as of 2026-05-14)
  // Priority 90 — Regional papers covering Anahuac
  { name: 'The Vindicator', url: 'https://thevindicator.com/feed/', weight: 90 },
  // Priority 60 — Chambers County (broader)
  { name: 'Google News - Chambers County Texas', url: 'https://news.google.com/rss/search?q=%22Chambers+County%22+Texas&hl=en-US&gl=US&ceid=US:en', weight: 60, googleNews: true },
  // Priority 50 — Neighboring towns
  { name: 'Google News - Mont Belvieu', url: 'https://news.google.com/rss/search?q=%22Mont+Belvieu%22+Texas&hl=en-US&gl=US&ceid=US:en', weight: 50, googleNews: true },
  // Priority 40 — Trinity Bay area
  { name: 'Google News - Trinity Bay Texas', url: 'https://news.google.com/rss/search?q=%22Trinity+Bay%22+Texas&hl=en-US&gl=US&ceid=US:en', weight: 40, googleNews: true },
  // Priority 30 — Winnie (only if Chambers County relevant)
  { name: 'Google News - Winnie Texas', url: 'https://news.google.com/rss/search?q=%22Winnie%22+Texas&hl=en-US&gl=US&ceid=US:en', weight: 30, googleNews: true,
    requireKeywords: ['chambers', 'jefferson', 'winnie tx', 'east chambers'] },
];

// City of Anahuac WordPress RSS (best-effort, may not exist)
const CITY_RSS_URLS = [
  'https://anahuac.us/feed/',
  'https://anahuac.us/category/news/feed/',
];

const TEXAS_FEEDS = [
  { name: 'Google News - Houston Texas', url: 'https://news.google.com/rss/search?q=%22Houston%22+Texas&hl=en-US&gl=US&ceid=US:en', weight: 100, googleNews: true },
  { name: 'Google News - Texas State', url: 'https://news.google.com/rss/search?q=%22Texas%22+state&hl=en-US&gl=US&ceid=US:en', weight: 95, googleNews: true,
    requireKeywords: ['texas', 'tx '] },
  { name: 'Google News - Galveston', url: 'https://news.google.com/rss/search?q=%22Galveston%22+Texas&hl=en-US&gl=US&ceid=US:en', weight: 85, googleNews: true },
  { name: 'Google News - Beaumont Texas', url: 'https://news.google.com/rss/search?q=%22Beaumont%22+Texas&hl=en-US&gl=US&ceid=US:en', weight: 75, googleNews: true },
  { name: 'Google News - Austin Texas', url: 'https://news.google.com/rss/search?q=%22Austin+Texas%22&hl=en-US&gl=US&ceid=US:en', weight: 70, googleNews: true },
  { name: 'Google News - Dallas Texas', url: 'https://news.google.com/rss/search?q=%22Dallas%22+Texas&hl=en-US&gl=US&ceid=US:en', weight: 65, googleNews: true },
  { name: 'Google News - San Antonio Texas', url: 'https://news.google.com/rss/search?q=%22San+Antonio%22+Texas&hl=en-US&gl=US&ceid=US:en', weight: 60, googleNews: true },
  // Direct feeds (already Texas-focused)
  { name: 'Texas Tribune', url: 'https://www.texastribune.org/feeds/articles.rss' },
];

// ── Texas keyword filter (safety net for Google News results) ──
const TEXAS_KEYWORDS = [
  'texas', 'tx ', 'houston', 'dallas', 'austin', 'san antonio',
  'fort worth', 'el paso', 'galveston', 'corpus christi',
  'beaumont', 'plano', 'arlington', 'amarillo', 'lubbock',
  'waco', 'tyler', 'longview', 'killeen', 'mcallen',
  'longhorns', 'aggies', 'rangers', 'astros', 'cowboys', 'mavericks',
  'rockets', 'spurs', 'texans', 'governor abbott', 'lt. governor patrick',
  'chambers county', 'anahuac', 'mont belvieu', 'baytown',
];

const NON_TEXAS_REJECT = [
  'washington monument', 'white house', 'capitol hill', 'congress passes',
  'middle east', 'ukraine', 'russia', 'china', 'gaza', 'israel',
  'florida zoo', 'california fires', 'new york city', 'chicago shooting',
  'wall street', 'pentagon', 'supreme court rules',
];

function isAboutTexas(article) {
  var text = ((article.title || '') + ' ' + (article.snippet || '')).toLowerCase();
  return TEXAS_KEYWORDS.some(function(k) { return text.includes(k); });
}

function isNonTexas(article) {
  var text = ((article.title || '') + ' ' + (article.snippet || '')).toLowerCase();
  for (var i = 0; i < NON_TEXAS_REJECT.length; i++) {
    if (text.includes(NON_TEXAS_REJECT[i])) {
      // Allow if it ALSO mentions Texas explicitly
      if (TEXAS_KEYWORDS.some(function(k) { return text.includes(k); })) return false;
      return true;
    }
  }
  return false;
}

const NATIONAL_FEEDS = [
  { name: 'AP News', url: 'https://rsshub.app/apnews/topics/apf-topnews' },
  { name: 'Reuters', url: 'https://www.reutersagency.com/feed/?taxonomy=best-topics&post_type=best' },
  { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
];

// In-memory cache with TTL
let _newsCache = { data: null, timestamp: 0 };
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// ── Core: build headlines from all RSS sources ──
async function buildHeadlines() {
  var result = { local: [], texas: [], national: [] };

  // ── LOCAL: Google News search + City of Anahuac RSS ──
  var allLocalItems = [];

  // Try City of Anahuac WordPress RSS (best-effort)
  for (var cityUrl of CITY_RSS_URLS) {
    try {
      var cityFeed = await parser.parseURL(cityUrl);
      if (cityFeed && cityFeed.items && cityFeed.items.length > 0) {
        console.log('[news] City of Anahuac RSS found at ' + cityUrl + ' — ' + cityFeed.items.length + ' items');
        cityFeed.items.slice(0, 10).forEach(function(ci) {
          var cityArticle = {
            title: (ci.title || '').trim(),
            link: ci.link || '',
            source: 'City of Anahuac',
            published: ci.pubDate || ci.isoDate || '',
            snippet: ci.contentSnippet ? ci.contentSnippet.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
            image: ci.enclosure?.url || ci['media:content']?.$.url || '',
            badge: 'OFFICIAL',
            source_priority: 100,
          };
          if (!isRecentArticle(cityArticle)) return;
          allLocalItems.push(cityArticle);
        });
        break; // Found working RSS, no need to try more URLs
      }
    } catch (e) {
      // Try next URL silently
    }
  }

  // Fetch Google News + direct local feeds
  var localPromises = LOCAL_FEEDS.map(source =>
    fetchFeed(source).catch(() => ({ items: [], _source: source }))
  );
  var localResults = await Promise.all(localPromises);
  for (var lr of localResults) {
    if (!lr.items) continue;
    for (var item of lr.items) {
      if (lr._requireKeywords) {
        var text = ((item.title || '') + ' ' + (item.snippet || '')).toLowerCase();
        if (!lr._requireKeywords.some(function(k) { return text.includes(k); })) continue;
      }
      allLocalItems.push(item);
    }
  }

  // Sort: source_priority DESC, then by date DESC. Deduplicate, limit.
  allLocalItems.sort((a, b) => {
    var priDiff = (b.source_priority || 50) - (a.source_priority || 50);
    if (priDiff !== 0) return priDiff;
    return new Date(b.published || 0) - new Date(a.published || 0);
  });
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

  // ── TEXAS: Google News + Texas Tribune ──
  var texasRaw = [];
  var texasPromises = TEXAS_FEEDS.map(source =>
    fetchFeed(source).catch(() => ({ items: [] }))
  );
  var texasResults = await Promise.all(texasPromises);
  for (var tr of texasResults) {
    if (!tr.items) continue;
    for (var tItem of tr.items) {
      if (tr._requireKeywords) {
        var tText = ((tItem.title || '') + ' ' + (tItem.snippet || '')).toLowerCase();
        if (!tr._requireKeywords.some(function(k) { return tText.includes(k); })) continue;
      }
      texasRaw.push(tItem);
    }
  }
  texasRaw = texasRaw.filter(function(a) { return isAboutTexas(a) && !isNonTexas(a); });
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
  var now = Date.now();
  _newsCache = { data: result, timestamp: now };
  try {
    var expiresAt = new Date(now + CACHE_TTL).toISOString();
    db.prepare("INSERT OR REPLACE INTO content_cache (cache_key, data, expires_at) VALUES (?,?,?)")
      .run('news_headlines', JSON.stringify(result), expiresAt);
  } catch {}

  return result;
}

// ── Public: get news headlines ──
router.get('/headlines', async (req, res) => {
  clearStaleCacheOnce();

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

  // Fetch fresh
  var result = await buildHeadlines();

  if (category !== 'all' && result[category]) {
    return res.json({ [category]: result[category], updated: _newsCache.timestamp });
  }
  res.json({ ...result, updated: _newsCache.timestamp });
});

async function fetchFeed(source) {
  var feed = await parser.parseURL(source.url);
  var items = [];
  var rawItems = (feed.items || []).slice(0, 20); // Check more items since we'll filter some out

  for (var item of rawItems) {
    var title = (item.title || '').trim();
    var itemSource = source.name;

    // Google News includes publisher in title: "Story Title - Publisher Name"
    if (source.googleNews) {
      var dashIdx = title.lastIndexOf(' - ');
      if (dashIdx > 0) {
        itemSource = title.slice(dashIdx + 3).trim();
        title = title.slice(0, dashIdx).trim();
      }
      // Google News search name → cleaner display
      itemSource = itemSource || source.name.replace('Google News - ', '');
    }

    var article = {
      title: title,
      link: item.link || '',
      source: itemSource,
      published: item.pubDate || item.isoDate || '',
      snippet: item.contentSnippet ? item.contentSnippet.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
      image: item.enclosure?.url || item['media:content']?.$.url || '',
      source_priority: source.weight || 50,
    };

    // Skip articles older than 3 days or with no valid date
    if (!isRecentArticle(article)) continue;

    // Skip real estate and classified-ad content (3-layer check)
    if (isBlockedContent(article, item.rssSource)) {
      console.log('[news] blocked: "' + article.title.slice(0, 60) + '" from ' + article.source);
      continue;
    }

    items.push(article);
    if (items.length >= 10) break; // Cap at 10 recent items per feed
  }

  return { items, _filter: source.filter, _section: source.section, _requireKeywords: source.requireKeywords };
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

// ── Server-side scheduled refresh: keep cache warm every 30 minutes ──
async function refreshNewsCache() {
  var now = Date.now();
  if (_newsCache.data && now - _newsCache.timestamp < CACHE_TTL) return; // Still fresh
  try {
    console.log('[news] scheduled refresh starting...');
    await buildHeadlines();
    console.log('[news] scheduled refresh complete — cache warm');
  } catch (e) {
    console.error('[news] scheduled refresh failed:', e.message);
  }
}

// Start scheduled refresh after 2 minutes (let server boot), then every 30 minutes
setTimeout(() => {
  refreshNewsCache();
  setInterval(refreshNewsCache, 30 * 60 * 1000);
}, 2 * 60 * 1000);

module.exports = router;

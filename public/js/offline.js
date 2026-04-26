/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Offline Mode Engine — IndexedDB queue + auto-sync
 */

// --- IndexedDB Setup ---
const OFFLINE_DB_NAME = 'rvpark_offline';
const OFFLINE_DB_VERSION = 1;
let _offlineDb = null;

function openOfflineDb() {
  return new Promise((resolve, reject) => {
    if (_offlineDb) return resolve(_offlineDb);
    const req = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('pending')) {
        db.createObjectStore('pending', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('cache')) {
        db.createObjectStore('cache', { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => { _offlineDb = e.target.result; resolve(_offlineDb); };
    req.onerror = (e) => reject(e.target.error);
  });
}

// --- Pending Queue ---
async function addPending(type, data) {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending', 'readwrite');
    tx.objectStore('pending').add({ type, data, createdAt: new Date().toISOString() });
    tx.oncomplete = () => { updateSyncBadge(); resolve(); };
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function getAllPending() {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending', 'readonly');
    const req = tx.objectStore('pending').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function removePending(id) {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending', 'readwrite');
    tx.objectStore('pending').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function clearAllPending() {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending', 'readwrite');
    tx.objectStore('pending').clear();
    tx.oncomplete = () => { updateSyncBadge(); resolve(); };
    tx.onerror = (e) => reject(e.target.error);
  });
}

// --- Cache ---
async function setCache(key, value) {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('cache', 'readwrite');
    tx.objectStore('cache').put({ key, value, cachedAt: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function getCache(key) {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('cache', 'readonly');
    const req = tx.objectStore('cache').get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = (e) => reject(e.target.error);
  });
}

// --- Online/Offline Detection ---
let _isOnline = navigator.onLine;
let _syncInterval = null;
let _lastSyncTime = null;
let _wasEverOffline = false; // Only show "back online" if we were actually offline

function isOffline() { return !_isOnline; }

function showOfflineBanner() {
  if (navigator.onLine === true) return;
  _wasEverOffline = true;
  var banner = document.getElementById('offline-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'offline-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10000;background:linear-gradient(135deg,#d97706,#f59e0b);color:#1c1917;padding:10px 16px;text-align:center;font-size:0.88rem;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer';
    banner.onclick = showEmergencyGuide;
    document.body.appendChild(banner);
  }
  banner.innerHTML = '📡 OFFLINE MODE — No internet connection. Data saved locally. <span style="text-decoration:underline;margin-left:4px">Emergency Guide →</span>';
  banner.style.display = '';
  updateConnectionDot('offline');
  // Show emergency guide on first offline event
  if (!window._emergencyGuideShown) { window._emergencyGuideShown = true; showEmergencyGuide(); }
}

function showOnlineBanner() {
  if (!_wasEverOffline) return;
  var banner = document.getElementById('offline-banner');
  if (banner) {
    banner.style.background = 'linear-gradient(135deg,#16a34a,#22c55e)';
    banner.style.color = '#fff';
    banner.innerHTML = '✅ Back Online! Syncing your offline data now...';
    banner.style.display = '';
    setTimeout(function() { banner.style.display = 'none'; }, 4000);
  }
  updateConnectionDot('online');
  _wasEverOffline = false;
}

function updateConnectionDot(state) {
  var dot = document.getElementById('connection-dot');
  if (!dot) {
    dot = document.createElement('div');
    dot.id = 'connection-dot';
    dot.style.cssText = 'position:fixed;top:8px;right:60px;z-index:9999;display:flex;align-items:center;gap:4px;font-size:0.68rem;font-weight:600;padding:3px 8px;border-radius:12px;background:rgba(255,255,255,0.95);box-shadow:0 1px 4px rgba(0,0,0,0.15)';
    document.body.appendChild(dot);
  }
  if (state === 'offline') { dot.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:#dc2626;display:inline-block"></span> Offline'; dot.style.color = '#dc2626'; }
  else if (state === 'syncing') { dot.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:#f59e0b;display:inline-block;animation:pulse 1s infinite"></span> Syncing'; dot.style.color = '#f59e0b'; }
  else { dot.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:#16a34a;display:inline-block"></span> Online'; dot.style.color = '#16a34a'; }
}

function showEmergencyGuide() {
  var existing = document.getElementById('emergency-guide-overlay');
  if (existing) { existing.remove(); return; }
  var overlay = document.createElement('div');
  overlay.id = 'emergency-guide-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:1rem';
  overlay.innerHTML =
    '<div style="background:#fff;border-radius:16px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;padding:1.5rem">' +
      '<h2 style="margin:0 0 0.75rem;color:#d97706;font-size:1.2rem">📡 CONNECTION LOST</h2>' +
      '<div style="background:#f0fdf4;border:1px solid #a7f3d0;border-radius:8px;padding:0.6rem 0.75rem;margin-bottom:0.75rem;font-size:0.88rem;color:#065f46;font-weight:600">YOUR DATA IS SAFE ✅<br><span style="font-weight:400;font-size:0.82rem">All data is stored on secure servers and will be there when internet returns.</span></div>' +
      '<h4 style="margin:0.75rem 0 0.35rem;color:#1c1917">What still works:</h4>' +
      '<div style="font-size:0.85rem;line-height:1.6;color:#44403c">' +
        '✅ View cached tenant list<br>✅ Check tenants in and out<br>✅ Log payments received<br>✅ Enter meter readings<br>✅ Log expenses<br>✅ Access emergency contacts</div>' +
      '<h4 style="margin:0.75rem 0 0.35rem;color:#1c1917">Needs internet:</h4>' +
      '<div style="font-size:0.85rem;line-height:1.6;color:#78716c">' +
        '❌ Sending SMS messages<br>❌ AI receipt scanning<br>❌ Live weather radar<br>❌ Syncing to server</div>' +
      '<h4 style="margin:0.75rem 0 0.35rem;color:#dc2626">Emergency Contacts:</h4>' +
      '<div style="font-size:0.88rem;line-height:1.8;color:#1c1917">' +
        '🚨 <strong>911</strong> — Life emergencies<br>' +
        '📞 <strong>(409) 267-6603</strong> — Park office<br>' +
        '🌀 <strong>(409) 267-2500</strong> — Chambers County OEM<br>' +
        '⚡ <strong>1-800-968-8243</strong> — Entergy outages</div>' +
      '<h4 style="margin:0.75rem 0 0.35rem;color:#1c1917">📱 Use Phone as Hotspot:</h4>' +
      '<div style="font-size:0.82rem;line-height:1.5;color:#44403c">' +
        '<strong>iPhone:</strong> Settings → Personal Hotspot → Allow Others to Join<br>' +
        '<strong>Android:</strong> Settings → Network → Hotspot → Turn On<br>' +
        '<span style="color:#78716c">Your phone\'s data can keep the app running when WiFi is down!</span></div>' +
      '<button onclick="document.getElementById(\'emergency-guide-overlay\').remove()" style="display:block;width:100%;margin-top:1rem;padding:0.75rem;background:#1a5c32;color:#fff;border:none;border-radius:10px;font-size:0.95rem;font-weight:700;cursor:pointer">Got it — Continue in Offline Mode</button>' +
    '</div>';
  document.body.appendChild(overlay);
}

function hideOfflineBanner() {
  var banner = document.getElementById('offline-banner');
  if (banner) banner.style.display = 'none';
}

window.addEventListener('online', function() {
  _isOnline = true;
  showOnlineBanner();
  syncPendingRecords();
});

window.addEventListener('offline', function() {
  _isOnline = false;
  showOfflineBanner();
});

// --- Sync Engine ---
async function syncPendingRecords() {
  if (!_isOnline || !API?.token) return;
  const pending = await getAllPending();
  if (!pending.length) { updateSyncBadge(); return; }

  updateConnectionDot('syncing');
  let synced = 0;
  for (const item of pending) {
    try {
      const endpoint = {
        checkin: '/checkins/checkin',
        meter: '/meters',
        payment: '/payments',
        expense: '/expenses',
        water_reading: '/water-meters/readings',
        note: '/tenants/' + (item.data?.tenant_id || 0),
      }[item.type];
      if (!endpoint) { await removePending(item.id); continue; }
      var method = item.type === 'note' ? 'put' : 'post';
      if (method === 'put') await API.put(endpoint, item.data);
      else await API.post(endpoint, item.data);
      await removePending(item.id);
      synced++;
    } catch (err) {
      console.error('[offline-sync] failed to sync ' + item.type + ':', err.message);
    }
  }

  _lastSyncTime = new Date();
  updateSyncBadge();
  updateSyncStatus();
  updateConnectionDot('online');

  if (synced > 0) {
    if (typeof showStatusToast === 'function') {
      showStatusToast('✅', `Synced ${synced} offline record${synced > 1 ? 's' : ''}`);
    }
    // Refresh current page to show synced data
    if (typeof navigateTo === 'function' && typeof currentPage !== 'undefined') {
      navigateTo(currentPage);
    }
  }
}

// Auto-sync every 30 seconds when online
function startSyncEngine() {
  if (_syncInterval) clearInterval(_syncInterval);
  _syncInterval = setInterval(() => {
    if (_isOnline) syncPendingRecords();
  }, 30000);
}

// --- UI Helpers ---
async function updateSyncBadge() {
  try {
    const pending = await getAllPending();
    const count = pending.length;
    // Update sidebar badge
    let badge = document.getElementById('sync-badge');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.id = 'sync-badge';
        badge.style.cssText = 'position:fixed;bottom:12px;left:220px;background:#dc2626;color:#fff;font-size:0.65rem;font-weight:800;padding:2px 6px;border-radius:10px;z-index:200;box-shadow:0 1px 4px rgba(0,0,0,0.3)';
        document.body.appendChild(badge);
      }
      badge.textContent = `${count} pending sync`;
      badge.style.display = '';
    } else if (badge) {
      badge.style.display = 'none';
    }
  } catch {}
}

function updateSyncStatus() {
  const el = document.getElementById('sync-status');
  if (!el) return;
  if (_lastSyncTime) {
    const ago = Math.round((Date.now() - _lastSyncTime.getTime()) / 1000);
    el.textContent = ago < 60 ? 'Just now' : `${Math.round(ago / 60)}m ago`;
  }
}

// --- Cache tenant list for offline lookup ---
async function cacheTenants(tenants) {
  if (!tenants) return;
  try { await setCache('tenants', tenants); } catch {}
}

async function getCachedTenants() {
  try {
    const cached = await getCache('tenants');
    return cached ? { data: cached.value, cachedAt: cached.cachedAt } : null;
  } catch { return null; }
}

// --- Offline-aware API wrapper ---
// Patches API.post to queue when offline for specific endpoints
function patchApiForOffline() {
  if (!window.API || API._offlinePatched) return;
  const origPost = API.post.bind(API);
  API.post = async function(url, data) {
    if (_isOnline) {
      const result = await origPost(url, data);
      // Cache tenants on successful load
      if (url === '/tenants' || url.startsWith('/tenants')) {
        try { const t = await API.get('/tenants'); cacheTenants(t); } catch {}
      }
      return result;
    }
    // Offline: queue supported operations
    var offlineTypes = {
      '/checkins/checkin': 'checkin',
      '/tenants': 'checkin',
      '/meters': 'meter',
      '/payments': 'payment',
      '/expenses': 'expense',
      '/water-meters/readings': 'water_reading',
    };
    for (var path in offlineTypes) {
      if (url === path || url.startsWith(path + '/')) {
        await addPending(offlineTypes[path], data);
        if (typeof showStatusToast === 'function') showStatusToast('📤', 'Saved offline — will sync when connected');
        return { id: 'offline-' + Date.now(), offline: true };
      }
    }
    throw new Error('This action requires an internet connection.');
  };

  const origGet = API.get.bind(API);
  API.get = async function(url) {
    if (_isOnline) {
      const result = await origGet(url);
      // Cache tenant list
      if (url === '/tenants') cacheTenants(result);
      return result;
    }
    // Offline: return cached data for tenants
    if (url === '/tenants') {
      const cached = await getCachedTenants();
      if (cached) {
        console.log('[offline] serving cached tenants from', cached.cachedAt);
        return cached.data;
      }
    }
    throw new Error('You are offline. This data is not available.');
  };
  API._offlinePatched = true;
}

// --- Initialize ---
function initOfflineMode() {
  _isOnline = navigator.onLine;
  openOfflineDb().then(function() {
    updateSyncBadge();
    startSyncEngine();
    patchApiForOffline();
    // Only show offline banner if genuinely offline — never on normal page load
    if (!navigator.onLine) {
      showOfflineBanner();
    }
    // Always hide any stale banner when online
    if (navigator.onLine) {
      hideOfflineBanner();
    }
    console.log('[offline] initialized, online=' + navigator.onLine);
  }).catch(function(err) {
    console.error('[offline] init failed:', err);
  });
}

// Auto-init after a short delay to let API load
setTimeout(initOfflineMode, 1000);

// Nuclear safety: kill offline banner 3 seconds after load if online
setTimeout(function() {
  if (navigator.onLine) {
    var b = document.getElementById('offline-banner');
    if (b) b.remove();
  }
}, 3000);

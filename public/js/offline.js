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
  // Never show if actually online
  if (navigator.onLine) return;
  _wasEverOffline = true;
  var banner = document.getElementById('offline-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'offline-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10000;background:linear-gradient(135deg,#d97706,#f59e0b);color:#1c1917;padding:8px 16px;text-align:center;font-size:0.85rem;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;gap:8px';
    document.body.appendChild(banner);
  }
  banner.innerHTML = '⚠️ OFFLINE MODE — Limited features available. Data will sync when reconnected.';
  banner.style.display = '';
}

function showOnlineBanner() {
  // Only show "back online" if we were actually offline before
  if (!_wasEverOffline) return;
  var banner = document.getElementById('offline-banner');
  if (banner) {
    banner.style.background = 'linear-gradient(135deg,#16a34a,#22c55e)';
    banner.style.color = '#fff';
    banner.innerHTML = '✅ Back online! Syncing data...';
    banner.style.display = '';
    setTimeout(function() { banner.style.display = 'none'; }, 3000);
  }
  _wasEverOffline = false;
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

  let synced = 0;
  for (const item of pending) {
    try {
      const endpoint = {
        checkin: '/tenants',
        meter: '/meters',
        payment: '/payments',
      }[item.type];
      if (!endpoint) { await removePending(item.id); continue; }
      await API.post(endpoint, item.data);
      await removePending(item.id);
      synced++;
    } catch (err) {
      console.error(`[offline-sync] failed to sync ${item.type} #${item.id}:`, err.message);
      // Don't remove — will retry next cycle
    }
  }

  _lastSyncTime = new Date();
  updateSyncBadge();
  updateSyncStatus();

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
    // Offline: queue certain operations
    if (url === '/tenants' || url === '/meters' || url === '/payments') {
      const type = url === '/tenants' ? 'checkin' : url === '/meters' ? 'meter' : 'payment';
      await addPending(type, data);
      return { id: 'offline-' + Date.now(), offline: true };
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

/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */

// =====================================================================
// Park Branding / Customization Settings Page
// =====================================================================

var _brandLogoData = null;   // { data, mime, url } or null
var _brandBannerData = null;

async function loadBranding() {
  if (API.user?.role !== 'admin') {
    document.getElementById('page-content').innerHTML = '<div class="card"><p>Admin access required.</p></div>';
    return;
  }
  document.getElementById('page-content').innerHTML = '<div style="display:flex;justify-content:center;padding:3rem"><div class="loading-spinner"></div></div>';

  var settings = {};
  try { settings = await API.get('/settings') || {}; } catch {}

  // Pre-populate image state from existing uploads
  _brandLogoData = null;
  _brandBannerData = null;

  document.getElementById('page-content').innerHTML = `
    ${typeof helpPanel === 'function' ? helpPanel('branding') : ''}
    <div class="page-header">
      <h2>🎨 Park Branding</h2>
    </div>

    <div style="display:grid;grid-template-columns:1fr 320px;gap:1rem;align-items:start" id="branding-grid">
      <!-- Left: Settings form -->
      <div>
        <!-- Park Info -->
        <div class="card" style="margin-bottom:1rem">
          <h3 style="margin-bottom:0.75rem">Park Information</h3>
          <div class="form-row">
            <div class="form-group"><label>Park Name</label><input id="brand-park-name" value="${_esc(settings.park_name || 'Anahuac RV Park')}"></div>
            <div class="form-group"><label>Phone</label><input id="brand-park-phone" value="${_esc(settings.park_phone || '')}"></div>
          </div>
          <div class="form-group"><label>Address</label><input id="brand-park-address" value="${_esc(settings.park_address || '')}"></div>
          <div class="form-row">
            <div class="form-group"><label>Email</label><input id="brand-park-email" type="email" value="${_esc(settings.park_email || '')}"></div>
            <div class="form-group"><label>Website (optional)</label><input id="brand-park-website" value="${_esc(settings.park_website || '')}" placeholder="https://"></div>
          </div>
        </div>

        <!-- Accent Color -->
        <div class="card" style="margin-bottom:1rem">
          <h3 style="margin-bottom:0.75rem">Accent Color</h3>
          <p style="font-size:0.82rem;color:var(--gray-500);margin-bottom:0.5rem">Choose a brand color to replace the default green throughout the app (buttons, nav, links, badges).</p>
          <div style="display:flex;align-items:center;gap:0.75rem">
            <input type="color" id="brand-accent-color" value="${settings.brand_accent_color || '#1a5c32'}" style="width:48px;height:40px;border:2px solid #e5e7eb;border-radius:6px;cursor:pointer;padding:2px">
            <input type="text" id="brand-accent-hex" value="${settings.brand_accent_color || '#1a5c32'}" style="width:100px;font-family:monospace;font-size:0.9rem" maxlength="7" oninput="syncColorFromHex(this.value)">
            <button class="btn btn-sm btn-outline" onclick="resetAccentColor()">Reset to default</button>
          </div>
        </div>

        <!-- Logo -->
        <div class="card" style="margin-bottom:1rem">
          <h3 style="margin-bottom:0.75rem">Park Logo</h3>
          <p style="font-size:0.82rem;color:var(--gray-500);margin-bottom:0.5rem">Upload a logo (JPG, PNG, GIF, WebP). Max 2 MB. Displayed in the sidebar and app header.</p>
          <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
            <div id="brand-logo-thumb" style="width:64px;height:64px;border:2px dashed #d6d3d1;border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#fafaf9">
              <span style="color:#a8a29e;font-size:0.7rem">No logo</span>
            </div>
            <div>
              <input type="file" id="brand-logo-input" accept="image/jpeg,image/png,image/gif,image/webp" style="display:none" onchange="handleBrandImage(event,'logo')">
              <button class="btn btn-sm btn-outline" onclick="document.getElementById('brand-logo-input').click()">Choose File</button>
              <button class="btn btn-sm btn-outline" id="brand-logo-remove-btn" style="display:none;color:#dc2626" onclick="removeBrandImage('logo')">Remove</button>
            </div>
          </div>
        </div>

        <!-- Banner -->
        <div class="card" style="margin-bottom:1rem">
          <h3 style="margin-bottom:0.75rem">Dashboard Banner Photo</h3>
          <p style="font-size:0.82rem;color:var(--gray-500);margin-bottom:0.5rem">Upload a park photo (JPG, PNG, WebP). Max 5 MB. Displays as a wide banner at the top of the dashboard (180-220px tall) with the greeting overlaid.</p>
          <div>
            <div id="brand-banner-thumb" style="width:100%;max-width:400px;height:100px;border:2px dashed #d6d3d1;border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#fafaf9;margin-bottom:0.5rem">
              <span style="color:#a8a29e;font-size:0.7rem">No banner</span>
            </div>
            <input type="file" id="brand-banner-input" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="handleBrandImage(event,'banner')">
            <button class="btn btn-sm btn-outline" onclick="document.getElementById('brand-banner-input').click()">Choose File</button>
            <button class="btn btn-sm btn-outline" id="brand-banner-remove-btn" style="display:none;color:#dc2626" onclick="removeBrandImage('banner')">Remove</button>
          </div>
        </div>

        <!-- Save -->
        <button class="btn btn-primary btn-full" id="brand-save-btn" onclick="saveBranding()" style="font-size:1rem;padding:0.75rem">Save All Changes</button>
        <div id="brand-save-status" style="text-align:center;margin-top:0.5rem;font-size:0.82rem;display:none"></div>
      </div>

      <!-- Right: Live Preview -->
      <div class="card" style="position:sticky;top:1rem">
        <h3 style="margin-bottom:0.75rem;font-size:0.9rem">Live Preview</h3>
        <div id="brand-preview" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
          <!-- Mini sidebar preview -->
          <div id="brand-preview-sidebar" style="background:#1a5c32;padding:0.75rem;display:flex;align-items:center;gap:0.6rem">
            <div id="brand-preview-logo" style="width:36px;height:36px;border-radius:6px;background:rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0">
              <span style="color:rgba(255,255,255,0.7);font-size:1rem">🐊</span>
            </div>
            <div id="brand-preview-name" style="color:#fff;font-weight:700;font-size:0.85rem">Anahuac RV Park</div>
          </div>
          <!-- Mini banner preview -->
          <div id="brand-preview-banner" style="height:80px;background:linear-gradient(135deg,#1a5c32,#0f3d22);display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden">
            <div style="position:relative;z-index:1;text-align:center">
              <div style="color:#fff;font-weight:700;font-size:0.82rem;text-shadow:0 1px 4px rgba(0,0,0,0.4)" id="brand-preview-greeting">Good evening, Admin!</div>
            </div>
          </div>
          <!-- Mini button samples -->
          <div style="padding:0.75rem;background:#fff;display:flex;gap:0.4rem;flex-wrap:wrap">
            <span class="brand-preview-btn" style="display:inline-block;padding:0.3rem 0.6rem;border-radius:6px;font-size:0.72rem;font-weight:600;color:#fff;background:#1a5c32">Primary Button</span>
            <span style="display:inline-block;padding:0.3rem 0.6rem;border-radius:6px;font-size:0.72rem;font-weight:600;color:#1a5c32;border:1px solid #1a5c32" class="brand-preview-outline">Outline</span>
            <a href="#" onclick="event.preventDefault()" style="font-size:0.72rem;font-weight:600;color:#1a5c32" class="brand-preview-link">Link Color</a>
          </div>
        </div>
      </div>
    </div>
  `;

  // Wire up color picker sync
  var picker = document.getElementById('brand-accent-color');
  var hexInput = document.getElementById('brand-accent-hex');
  if (picker) picker.addEventListener('input', function() {
    hexInput.value = picker.value;
    updateBrandPreview();
  });
  if (hexInput) hexInput.addEventListener('input', function() {
    syncColorFromHex(hexInput.value);
  });

  // Wire up park name live preview
  var nameInput = document.getElementById('brand-park-name');
  if (nameInput) nameInput.addEventListener('input', updateBrandPreview);

  // Load existing images
  loadBrandingImages(settings);
}

function _esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function syncColorFromHex(val) {
  val = String(val).trim();
  if (/^#[0-9a-fA-F]{6}$/.test(val)) {
    document.getElementById('brand-accent-color').value = val;
  }
  document.getElementById('brand-accent-hex').value = val;
  updateBrandPreview();
}

function resetAccentColor() {
  document.getElementById('brand-accent-color').value = '#1a5c32';
  document.getElementById('brand-accent-hex').value = '#1a5c32';
  updateBrandPreview();
}

function updateBrandPreview() {
  var color = document.getElementById('brand-accent-color')?.value || '#1a5c32';
  var name = document.getElementById('brand-park-name')?.value || 'RV Park';

  // Sidebar bg
  var sidebar = document.getElementById('brand-preview-sidebar');
  if (sidebar) sidebar.style.background = color;

  // Park name
  var nameEl = document.getElementById('brand-preview-name');
  if (nameEl) nameEl.textContent = name;

  // Banner gradient
  var banner = document.getElementById('brand-preview-banner');
  if (banner && !_brandBannerData) {
    banner.style.background = 'linear-gradient(135deg,' + color + ',' + darkenColor(color, 30) + ')';
  }

  // Buttons
  document.querySelectorAll('.brand-preview-btn').forEach(function(el) { el.style.background = color; });
  document.querySelectorAll('.brand-preview-outline').forEach(function(el) { el.style.color = color; el.style.borderColor = color; });
  document.querySelectorAll('.brand-preview-link').forEach(function(el) { el.style.color = color; });

  // Greeting
  var hr = new Date().getHours();
  var greeting = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  var greetEl = document.getElementById('brand-preview-greeting');
  if (greetEl) greetEl.textContent = greeting + ', Admin!';
}

function darkenColor(hex, amount) {
  hex = hex.replace('#', '');
  var r = Math.max(0, parseInt(hex.slice(0, 2), 16) - amount);
  var g = Math.max(0, parseInt(hex.slice(2, 4), 16) - amount);
  var b = Math.max(0, parseInt(hex.slice(4, 6), 16) - amount);
  return '#' + [r, g, b].map(function(v) { return v.toString(16).padStart(2, '0'); }).join('');
}

async function loadBrandingImages(settings) {
  // Logo
  try {
    var logoRes = await fetch('/api/settings/branding/image/logo');
    if (logoRes.ok) {
      var blob = await logoRes.blob();
      var url = URL.createObjectURL(blob);
      _brandLogoData = { url: url, existing: true };
      showLogoThumb(url);
    }
  } catch {}

  // Banner
  try {
    var bannerRes = await fetch('/api/settings/branding/image/banner');
    if (bannerRes.ok) {
      var blob = await bannerRes.blob();
      var url = URL.createObjectURL(blob);
      _brandBannerData = { url: url, existing: true };
      showBannerThumb(url);
    }
  } catch {}

  updateBrandPreview();
}

function showLogoThumb(url) {
  var el = document.getElementById('brand-logo-thumb');
  if (el) el.innerHTML = '<img src="' + url + '" style="width:100%;height:100%;object-fit:contain">';
  var btn = document.getElementById('brand-logo-remove-btn');
  if (btn) btn.style.display = '';
  // Preview
  var prev = document.getElementById('brand-preview-logo');
  if (prev) prev.innerHTML = '<img src="' + url + '" style="width:100%;height:100%;object-fit:contain">';
}

function showBannerThumb(url) {
  var el = document.getElementById('brand-banner-thumb');
  if (el) el.innerHTML = '<img src="' + url + '" style="width:100%;height:100%;object-fit:cover">';
  var btn = document.getElementById('brand-banner-remove-btn');
  if (btn) btn.style.display = '';
  // Preview
  var prev = document.getElementById('brand-preview-banner');
  if (prev) {
    prev.style.backgroundImage = 'url(' + url + ')';
    prev.style.backgroundSize = 'cover';
    prev.style.backgroundPosition = 'center';
  }
}

function handleBrandImage(event, type) {
  var file = event.target.files && event.target.files[0];
  if (!file) return;
  var limit = type === 'logo' ? 2 * 1024 * 1024 : 5 * 1024 * 1024;
  if (file.size > limit) {
    alert('File too large. Max ' + (limit / 1024 / 1024) + ' MB.');
    event.target.value = '';
    return;
  }
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
    alert('Unsupported file type. Use JPG, PNG, GIF, or WebP.');
    event.target.value = '';
    return;
  }
  var reader = new FileReader();
  reader.onload = function(ev) {
    var base64 = ev.target.result.split(',')[1];
    var url = URL.createObjectURL(file);
    if (type === 'logo') {
      _brandLogoData = { data: base64, mime: file.type, url: url };
      showLogoThumb(url);
    } else {
      _brandBannerData = { data: base64, mime: file.type, url: url };
      showBannerThumb(url);
    }
    updateBrandPreview();
  };
  reader.readAsDataURL(file);
}

function removeBrandImage(type) {
  if (type === 'logo') {
    _brandLogoData = { removed: true };
    var el = document.getElementById('brand-logo-thumb');
    if (el) el.innerHTML = '<span style="color:#a8a29e;font-size:0.7rem">No logo</span>';
    document.getElementById('brand-logo-remove-btn').style.display = 'none';
    document.getElementById('brand-logo-input').value = '';
    var prev = document.getElementById('brand-preview-logo');
    if (prev) prev.innerHTML = '<span style="color:rgba(255,255,255,0.7);font-size:1rem">🐊</span>';
  } else {
    _brandBannerData = { removed: true };
    var el = document.getElementById('brand-banner-thumb');
    if (el) el.innerHTML = '<span style="color:#a8a29e;font-size:0.7rem">No banner</span>';
    document.getElementById('brand-banner-remove-btn').style.display = 'none';
    document.getElementById('brand-banner-input').value = '';
    var prev = document.getElementById('brand-preview-banner');
    if (prev) {
      prev.style.backgroundImage = '';
      prev.style.backgroundSize = '';
    }
    updateBrandPreview();
  }
}

async function saveBranding() {
  var btn = document.getElementById('brand-save-btn');
  var status = document.getElementById('brand-save-status');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  status.style.display = 'none';

  try {
    // 1. Save text settings
    var color = document.getElementById('brand-accent-hex')?.value || '#1a5c32';
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) color = '#1a5c32';

    await API.put('/settings', {
      park_name: document.getElementById('brand-park-name')?.value || '',
      park_phone: document.getElementById('brand-park-phone')?.value || '',
      park_address: document.getElementById('brand-park-address')?.value || '',
      park_email: document.getElementById('brand-park-email')?.value || '',
      park_website: document.getElementById('brand-park-website')?.value || '',
      brand_accent_color: color,
    });

    // 2. Upload/remove logo
    if (_brandLogoData?.removed) {
      await API.del('/settings/branding/image/logo');
      _brandLogoData = null;
    } else if (_brandLogoData?.data) {
      await API.post('/settings/branding/image/logo', { data: _brandLogoData.data, mime: _brandLogoData.mime });
      _brandLogoData = { url: _brandLogoData.url, existing: true };
    }

    // 3. Upload/remove banner
    if (_brandBannerData?.removed) {
      await API.del('/settings/branding/image/banner');
      _brandBannerData = null;
    } else if (_brandBannerData?.data) {
      await API.post('/settings/branding/image/banner', { data: _brandBannerData.data, mime: _brandBannerData.mime });
      _brandBannerData = { url: _brandBannerData.url, existing: true };
    }

    // 4. Apply branding immediately throughout the app
    if (typeof applyBranding === 'function') applyBranding();

    status.textContent = '✅ Saved successfully! Changes applied.';
    status.style.color = '#16a34a';
    status.style.display = '';
  } catch (err) {
    status.textContent = '❌ Save failed: ' + (err.message || 'unknown error');
    status.style.color = '#dc2626';
    status.style.display = '';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save All Changes';
  }
}

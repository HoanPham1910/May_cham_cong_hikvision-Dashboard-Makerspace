// ═══════════════════════════════════════════════════════
//  app.js — Events, Users, Stats, Clock, Filters
// ═══════════════════════════════════════════════════════

const API_BASE = `${window.location.protocol}//${window.location.hostname}:8080`;


const REFRESH_SEC = 5;

let allEvents     = [];
let currentFilter = 'all';
let countdown     = REFRESH_SEC;
let countdownInterval;

// Dùng chung cho attendance & settings
let currentEmployeeId   = '';
let currentEmployeeName = '';

// Map tên → user object (dùng cho ranking)
let usersMap = {};

// ── Clock ──────────────────────────────────────────────
const dateInput = document.getElementById('dateInput');
dateInput.value = new Date().toISOString().split('T')[0];

function updateClock() {
  document.getElementById('clock').textContent =
    new Date().toLocaleTimeString('vi-VN', { hour12: false });
}
setInterval(updateClock, 1000);
updateClock();


// ── Init ────────────────────────────────────────────────
window.onload = function () {
  console.log("===== WINDOW ONLOAD =====");
  console.log("hostname =", window.location.hostname);
  console.log("protocol =", window.location.protocol);
  console.log("host =", window.location.host);
  console.log("port =", window.location.port);
  console.log("origin =", window.location.origin);
  console.log("href =", window.location.href);
  console.log("API_BASE =", API_BASE);

  fetchEvents();
  fetchUsersMap();
};
// ── Page switching ──────────────────────────────────────
function showPage(page, btn) {
  document.querySelectorAll('.page-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('page-events').style.display = page === 'events' ? '' : 'none';
  document.getElementById('page-users').style.display  = page === 'users'  ? '' : 'none';
  if (page === 'users') fetchUsers();
}

// ── Event filter ────────────────────────────────────────
function setFilter(f, btn) {
  currentFilter = f;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderEvents();
}

// ── Fetch events ────────────────────────────────────────
async function fetchEvents() {
  const date = dateInput.value;
  clearInterval(countdownInterval);
  document.getElementById('countdown').textContent = '';
  document.getElementById('errorMsg').style.display = 'none';
  document.getElementById('events-list').innerHTML =
    '<div class="status-msg"><div class="spinner"></div><span>Đang tải...</span></div>';

  try {
    const res  = await fetch(`${API_BASE}/api/events?date=${date}`);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch(e) { throw new Error('Server trả về lỗi: ' + text.substring(0, 200)); }

    if (!data.success) throw new Error(data.error || 'Lỗi không xác định');

    allEvents = data.events.filter(e => e.id != 51);
    updateStats();
    renderEvents();

    // Cập nhật ranking sau khi có events
    updateRanking();
    startCountdown();
  } catch(err) {
    showError(err.message);
  }
}

// ── Render event list ───────────────────────────────────
function renderEvents() {
  const list = document.getElementById('events-list');
  const filtered = currentFilter === 'all'
    ? allEvents
    : allEvents.filter(e => e.status === currentFilter);

  document.getElementById('eventCount').textContent = `${filtered.length} sự kiện`;

  if (filtered.length === 0) {
    list.innerHTML = '<div class="status-msg">📭 Không có dữ liệu</div>';
    document.getElementById('latestBanner').style.display = 'none';
    return;
  }

  const latest = filtered[0];
  document.getElementById('latestBanner').style.display = 'flex';
  document.getElementById('latestName').textContent = `${latest.name} · ${latest.label || latest.status}`;
  document.getElementById('latestTime').textContent  = formatTime(latest.time);

  list.innerHTML = filtered.map((ev, i) => {
    const sc   = ev.status === 'checkIn' ? 'checkin' : ev.status === 'checkOut' ? 'checkout' : 'unknown';
    const icon = ev.status === 'checkIn' ? '↓' : ev.status === 'checkOut' ? '↑' : '·';
    const statusLabel = ev.status === 'checkIn' ? '🟢 Đang có mặt' : '⚪ Đã ra về';
    return `
      <div class="event-card ${sc}" style="animation-delay:${i * 0.04}s">
        <div class="avatar ${sc}">${(ev.name || '?').charAt(0).toUpperCase()}</div>
        <div class="event-info">
          <div class="event-name">${ev.name || 'Unknown'}</div>
          <div class="event-id">ID: ${ev.id} &nbsp;·&nbsp; #${ev.serialNo || '—'} &nbsp;·&nbsp;
            <span style="color:${ev.status==='checkIn'?'var(--accent-in)':'var(--accent-out)'};font-weight:600">
              ${ev.status==='checkIn'?'Đang có mặt':'Đã ra về'}
            </span>
          </div>
        </div>
        <div class="event-right">
          <div class="event-time">${formatTime(ev.time)}</div>
          <span class="event-badge ${sc}">${icon} ${ev.label || ev.status}</span>
          <span class="event-badge status-present">${statusLabel}</span>
        </div>
      </div>`;
  }).join('');
}

// ── Stats ───────────────────────────────────────────────
function updateStats() {
  document.getElementById('stat-in').textContent  = allEvents.filter(e => e.status === 'checkIn').length;
  document.getElementById('stat-out').textContent = allEvents.filter(e => e.status === 'checkOut').length;
}

// ── Users ───────────────────────────────────────────────
async function fetchUsers() {
  document.getElementById('users-grid').innerHTML =
    '<div class="status-msg"><div class="spinner"></div><span>Đang tải...</span></div>';

  try {
    const res  = await fetch(`${API_BASE}/api/users`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    const users = data.users || [];
    document.getElementById('userCount').textContent = `${users.length} sinh viên`;

    // Lấy profiles từ MongoDB
    const profileMap = {};
    try {
      const pRes  = await fetch(`${API_BASE}/api/student/profiles`);
      const pData = await pRes.json();
      if (pData.success) pData.profiles.forEach(p => { profileMap[String(p.empId)] = p; });
    } catch(e) { /* MongoDB chưa có thì bỏ qua */ }

    const checkedInIds = new Set(allEvents.filter(e => e.status === 'checkIn').map(e => e.id));

    document.getElementById('users-grid').innerHTML = users.map((u, i) => {
      const isPresent = checkedInIds.has(String(u.id));
      const profile   = profileMap[String(u.id)] || {};
      const faceImg   = profile.avatar || localStorage.getItem(`avatar_${u.id}`) || u.faceURL || null;
      const faceHtml  = faceImg
        ? `<img src="${faceImg}" style="width:100%;height:100%;object-fit:cover;display:block"
               onerror="this.parentElement.innerHTML='<span>${(u.name||'?').charAt(0).toUpperCase()}</span>'">`
        : `<span>${(u.name || '?').charAt(0).toUpperCase()}</span>`;
      return `
        <div class="user-card ${isPresent ? 'present' : ''}"
             style="animation-delay:${i * 0.03}s"
             onclick="openModal('${u.id}','${u.name.replace(/'/g,"\\'")}')">
          <div class="user-face-placeholder">${faceHtml}</div>
          <div class="user-card-info">
            <div class="user-card-name">${u.name || 'Unknown'}</div>
            <div class="user-card-id">ID: ${u.id}</div>
            <div class="user-card-badges">
              ${u.numOfFace > 0 ? '<span class="user-tag">👤 Face</span>' : ''}
              ${u.numOfFP   > 0 ? '<span class="user-tag">👆 FP</span>'   : ''}
              ${isPresent ? '<span class="user-tag" style="color:var(--accent-in);border-color:#b8dfc8;background:var(--accent-in-light)">✓ Có mặt</span>' : ''}
            </div>
          </div>
        </div>`;
    }).join('');
  } catch(e) {
    document.getElementById('users-grid').innerHTML = `<div class="status-msg">⚠ ${e.message}</div>`;
  }
}

async function fetchUsersMap() {
  try {
    const res  = await fetch(`${API_BASE}/api/users`);
    const data = await res.json();
    if (data.success) {
      data.users.forEach(u => { usersMap[u.name] = u; });
      document.getElementById('stat-users').textContent = data.total;
    }
  } catch(e) { console.error('fetchUsersMap error:', e); }
}

// ── Helpers ─────────────────────────────────────────────
function formatTime(isoStr) {
  if (!isoStr) return '—';
  try { return new Date(isoStr).toLocaleTimeString('vi-VN', { hour12: false }); }
  catch { return isoStr; }
}

function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = '⚠ ' + msg;
  el.style.display = 'block';
  document.getElementById('events-list').innerHTML =
    '<div class="status-msg">Không thể tải dữ liệu</div>';
}

function startCountdown() {
  countdown = REFRESH_SEC;
  const el  = document.getElementById('countdown');
  clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    countdown--;
    el.textContent = `↺ ${countdown}s`;
    if (countdown <= 0) {
      clearInterval(countdownInterval);
      fetchEvents();
      fetchUsersMap();
    }
  }, 1000);
}

function avatarHtml(name, size = 36) {
  const u = usersMap[name];
  if (u && u.faceURL) {
    return `<img src="${u.faceURL}"
              style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;border:2px solid #e0dbd3;flex-shrink:0"
              onerror="this.replaceWith(initials('${name.charAt(0)}',${size}))">`;
  }
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:var(--accent-blue-light);color:var(--accent-blue);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${Math.round(size*0.4)}px;flex-shrink:0">
    ${name.charAt(0).toUpperCase()}
  </div>`;
}

// ── Init ────────────────────────────────────────────────
fetchEvents();
fetchUsersMap();
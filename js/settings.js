// ═══════════════════════════════════════════════════════
//  settings.js — Cài đặt ca làm, ghi đè từng ngày
// ═══════════════════════════════════════════════════════

// In-memory settings store: key = "empId|YYYY-MM"
const settingsStore = {};

function settingsKey(empId, month) { return `${empId}|${month}`; }

function getSettings(empId, month) {
  const key = settingsKey(empId, month);
  if (!settingsStore[key]) {
    settingsStore[key] = {
      signIn:       '',
      signOut:      '',
      graceMinutes: 120,
      overrides:    {}
    };
  }
  return settingsStore[key];
}

// ── Lưu settings lên MongoDB ─────────────────────────────
async function pushSettingsToDB(empId, month, cfg) {
  try {
    await fetch(`${API_BASE}/api/settings`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ empId, month, ...cfg })
    });
  } catch(e) {
    console.warn('[Settings] Không lưu được lên server:', e);
  }
}

// ── Đọc settings từ MongoDB, merge vào settingsStore ────
async function pullSettingsFromDB(empId, month) {
  try {
    const res  = await fetch(`${API_BASE}/api/settings/${empId}/${month}`);
    const data = await res.json();
    if (data.success && data.settings) {
      const s   = data.settings;
      const key = settingsKey(empId, month);
      settingsStore[key] = {
        signIn:       s.signIn       || '',
        signOut:      s.signOut      || '',
        graceMinutes: s.graceMinutes ?? 120,
        overrides:    s.overrides    || {}
      };
      // ✅ return true chỉ khi có data thực sự
      return !!(s.signIn || s.signOut || Object.keys(s.overrides || {}).length > 0);
    }
  } catch(e) {
    console.warn('[Settings] Không đọc được từ server:', e);
  }
  return false;
}
// ── Mở modal cài đặt ────────────────────────────────────
async function SettingAttendance() {
  const month = document.getElementById('modalMonth').value;
  if (!currentEmployeeId) { alert('Vui lòng chọn sinh viên trước.'); return; }

  document.getElementById('settingsSubtitle').textContent =
    `${currentEmployeeName} · Tháng ${month}`;

  document.getElementById('savedMsg').style.display = 'none';
  document.getElementById('settingsModal').style.display = 'flex';

  await pullSettingsFromDB(currentEmployeeId, month);

  const cfg = getSettings(currentEmployeeId, month);
  document.getElementById('settingSignIn').value  = cfg.signIn  || '';
  document.getElementById('settingSignOut').value = cfg.signOut || '';
  document.getElementById('graceSlider').value    = cfg.graceMinutes;
  updateGraceDisplay(document.getElementById('graceSlider'));

  buildOverrideTable(month, cfg);
}

function closeSettingsModal(e) {
  if (e.target === document.getElementById('settingsModal'))
    document.getElementById('settingsModal').style.display = 'none';
}

// ── Grace period slider ──────────────────────────────────
function updateGraceDisplay(slider) {
  const val = parseInt(slider.value);
  const h   = Math.floor(val / 60);
  const m   = val % 60;
  const label = h > 0 ? `${h}h${m > 0 ? m + 'p' : ''}` : `${m} phút`;
  document.getElementById('graceDisplay').textContent = label;

  const signIn = document.getElementById('settingSignIn').value;
  if (signIn) {
    const [sh, sm]  = signIn.split(':').map(Number);
    const totalMins = sh * 60 + sm + val;
    const lh        = Math.floor(totalMins / 60) % 24;
    const lm        = totalMins % 60;
    document.getElementById('graceHintTime').textContent =
      `${String(lh).padStart(2,'0')}:${String(lm).padStart(2,'0')}`;
  } else {
    document.getElementById('graceHintTime').textContent = '—';
  }

  const pct = (val / parseInt(slider.max)) * 100;
  slider.style.setProperty('--pct', pct + '%');
}

document.getElementById('settingSignIn').addEventListener('input', () => {
  updateGraceDisplay(document.getElementById('graceSlider'));
});

// ── Bảng ghi đè từng ngày ───────────────────────────────
function buildOverrideTable(month, cfg) {
  const tbody       = document.getElementById('overrideTableBody');
  const [year, mon] = month.split('-').map(Number);
  const daysInMonth = new Date(year, mon, 0).getDate();
  const rows        = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr   = `${year}-${String(mon).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dow       = new Date(dateStr).getDay();
    const isWeekend = dow === 0 || dow === 6;
    const ov        = (cfg.overrides || {})[dateStr] || {};
    const inVal     = ov.in  || '';
    const outVal    = ov.out || '';
    const hasOv     = ov.in || ov.out;
    const dowLabel  = ['CN','T2','T3','T4','T5','T6','T7'][dow];

    const phIn  = cfg.signIn  || '';
    const phOut = cfg.signOut || '';

    rows.push(`
      <tr style="${isWeekend ? 'opacity:.45' : ''}">
        <td>
          <span style="font-size:10px;color:var(--text-dim)">${dowLabel}</span>
          ${d}/${mon}
        </td>
        <td>
          <input type="time" class="override-time-input ${inVal ? 'overridden' : ''}"
                 id="ov-in-${dateStr}" value="${inVal}"
                 oninput="markOverride(this)"
                 ${phIn ? `placeholder="${phIn}"` : ''}>
        </td>
        <td>
          <input type="time" class="override-time-input ${outVal ? 'overridden' : ''}"
                 id="ov-out-${dateStr}" value="${outVal}"
                 oninput="markOverride(this)"
                 ${phOut ? `placeholder="${phOut}"` : ''}>
        </td>
        <td>
          ${hasOv
            ? `<button class="override-clear-btn" title="Xóa ghi đè"
                       onclick="clearOverrideRow('${dateStr}')">✕</button>`
            : ''}
        </td>
      </tr>`);
  }

  tbody.innerHTML = rows.join('');
}

function markOverride(input) {
  if (input.value) input.classList.add('overridden');
  else             input.classList.remove('overridden');
}

function clearOverrideRow(dateStr) {
  const inEl  = document.getElementById(`ov-in-${dateStr}`);
  const outEl = document.getElementById(`ov-out-${dateStr}`);
  if (inEl)  { inEl.value  = ''; inEl.classList.remove('overridden'); }
  if (outEl) { outEl.value = ''; outEl.classList.remove('overridden'); }
  const btn = document.querySelector(`button[onclick="clearOverrideRow('${dateStr}')"]`);
  if (btn) btn.remove();
}

// ── Lưu cài đặt ─────────────────────────────────────────
async function saveSettings() {
  const month = document.getElementById('modalMonth').value;
  const cfg   = getSettings(currentEmployeeId, month);

  cfg.signIn       = document.getElementById('settingSignIn').value  || '';
  cfg.signOut      = document.getElementById('settingSignOut').value || '';
  cfg.graceMinutes = parseInt(document.getElementById('graceSlider').value);

  const [year, mon] = month.split('-').map(Number);
  const daysInMonth = new Date(year, mon, 0).getDate();

  cfg.overrides = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(mon).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const inVal   = (document.getElementById(`ov-in-${dateStr}`)  || {}).value || '';
    const outVal  = (document.getElementById(`ov-out-${dateStr}`) || {}).value || '';
    if (inVal || outVal) cfg.overrides[dateStr] = { in: inVal, out: outVal };
  }

  await pushSettingsToDB(currentEmployeeId, month, cfg);

  const msg = document.getElementById('savedMsg');
  msg.textContent   = '✓ Đã lưu!';
  msg.style.display = 'inline-block';
  setTimeout(() => { msg.style.display = 'none'; }, 2200);

  loadAttendance();
}

// ── Đặt lại về mặc định ─────────────────────────────────
async function resetAllSettings() {
  if (!confirm('Đặt lại tất cả cài đặt về mặc định?')) return;

  const month = document.getElementById('modalMonth').value;
  const key   = settingsKey(currentEmployeeId, month);
  delete settingsStore[key];

  await pushSettingsToDB(currentEmployeeId, month, {
    signIn: '', signOut: '', graceMinutes: 120, overrides: {}
  });

  const cfg = getSettings(currentEmployeeId, month);
  document.getElementById('settingSignIn').value  = cfg.signIn  || '';
  document.getElementById('settingSignOut').value = cfg.signOut || '';
  document.getElementById('graceSlider').value    = cfg.graceMinutes;
  updateGraceDisplay(document.getElementById('graceSlider'));
  buildOverrideTable(month, cfg);
  loadAttendance();
}

// ── Nhập lịch từ backend (từ trang đăng ký của sinh viên) ──
async function importFromAdminPage() {
  const month = document.getElementById('modalMonth').value;
  if (!currentEmployeeId || !month) {
    alert('Vui lòng mở tháng cần xem trước');
    return;
  }

  try {
    const res  = await fetch(`${API_BASE}/api/schedule?empId=${currentEmployeeId}&month=${month}`);
    const data = await res.json();

    if (!data.success || data.count === 0) {
      alert('Sinh viên chưa đăng ký lịch tháng này');
      return;
    }

    const cfg = getSettings(currentEmployeeId, month);
    Object.assign(cfg.overrides, data.days);

    await pushSettingsToDB(currentEmployeeId, month, cfg);

    buildOverrideTable(month, cfg);
    loadAttendance();

    const msg = document.getElementById('savedMsg');
    msg.textContent = `✓ Đã nhận ${data.count} ngày từ lịch đăng ký!`;
    msg.style.display = 'inline-block';
    setTimeout(() => { msg.textContent = '✓ Đã lưu!'; msg.style.display = 'none'; }, 3000);
  } catch(e) {
    alert('Lỗi kết nối: ' + e.message);
  }
}
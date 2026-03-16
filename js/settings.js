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
      signIn:       '',     // không còn mặc định cứng
      signOut:      '',
      graceMinutes: 120,
      overrides:    {}
    };
  }
  return settingsStore[key];
}

// ── Mở modal cài đặt ────────────────────────────────────
function SettingAttendance() {
  const month = document.getElementById('modalMonth').value;
  if (!currentEmployeeId) { alert('Vui lòng chọn sinh viên trước.'); return; }

  document.getElementById('settingsSubtitle').textContent =
    `${currentEmployeeName} · Tháng ${month}`;

  const cfg = getSettings(currentEmployeeId, month);
  document.getElementById('settingSignIn').value  = cfg.signIn  || '';
  document.getElementById('settingSignOut').value = cfg.signOut || '';
  document.getElementById('graceSlider').value    = cfg.graceMinutes;
  updateGraceDisplay(document.getElementById('graceSlider'));

  buildOverrideTable(month, cfg);
  document.getElementById('savedMsg').style.display = 'none';
  document.getElementById('settingsModal').style.display = 'flex';
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

  // Chỉ tính giờ deadline nếu có giờ vào ca
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
    const ov        = cfg.overrides[dateStr] || {};
    const inVal     = ov.in  || '';
    const outVal    = ov.out || '';
    const hasOv     = ov.in || ov.out;
    const dowLabel  = ['CN','T2','T3','T4','T5','T6','T7'][dow];

    // placeholder dùng giờ ca chung nếu có, không thì để trống
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
function saveSettings() {
  const month = document.getElementById('modalMonth').value;
  const cfg   = getSettings(currentEmployeeId, month);

  // Lưu đúng những gì người dùng nhập, không ép mặc định
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

  const msg = document.getElementById('savedMsg');
  msg.style.display = 'inline-block';
  setTimeout(() => { msg.style.display = 'none'; }, 2200);

  loadAttendance();
}

// ── Đặt lại về mặc định ─────────────────────────────────
function resetAllSettings() {
  if (!confirm('Đặt lại tất cả cài đặt về mặc định?')) return;

  const month = document.getElementById('modalMonth').value;
  const key   = settingsKey(currentEmployeeId, month);
  delete settingsStore[key];

  const cfg = getSettings(currentEmployeeId, month);
  document.getElementById('settingSignIn').value  = cfg.signIn  || '';
  document.getElementById('settingSignOut').value = cfg.signOut || '';
  document.getElementById('graceSlider').value    = cfg.graceMinutes;
  updateGraceDisplay(document.getElementById('graceSlider'));
  buildOverrideTable(month, cfg);
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
    // Merge: lịch đăng ký ghi đè vào overrides
    Object.assign(cfg.overrides, data.days);
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
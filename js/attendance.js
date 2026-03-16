// ═══════════════════════════════════════════════════════
//  attendance.js — Modal điểm danh & Calendar render
// ═══════════════════════════════════════════════════════

const STATUS_CFG = {
  present:    { icon: '✅', label: 'Đúng giờ',     cls: 's-present' },
  late:       { icon: '⚠️', label: 'Đi trễ',       cls: 's-late' },
  absent:     { icon: '❌', label: 'Vắng',          cls: 's-absent' },
  absent_out: { icon: '🚫', label: 'No check-out', cls: 's-absent_out' },
  off:        { icon: '😴', label: 'Nghỉ',          cls: 's-off' },
  future:     { icon: '⏳', label: 'Chưa đến',      cls: 's-future' },
};

// ── Mở modal ────────────────────────────────────────────
function openModal(id, name) {
  currentEmployeeId   = id;
  currentEmployeeName = name;
  document.getElementById('modalName').textContent = name;
  document.getElementById('modalId').textContent   = `ID: ${id}`;

  const now = new Date();
  document.getElementById('modalMonth').value =
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  document.getElementById('attendanceModal').style.display = 'flex';
  loadAttendance();
}

function closeModal(e) {
  if (e.target === document.getElementById('attendanceModal'))
    document.getElementById('attendanceModal').style.display = 'none';
}

// ── Tải dữ liệu điểm danh ───────────────────────────────
async function loadAttendance() {
  const month = document.getElementById('modalMonth').value;
  document.getElementById('attendanceContent').innerHTML =
    '<div class="status-msg"><div class="spinner"></div><span>Đang tải...</span></div>';

  try {
    const res  = await fetch(`${API_BASE}/api/attendance?id=${currentEmployeeId}&month=${month}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    let days = json.days || [];
    if (days.length === 0) {
      document.getElementById('attendanceContent').innerHTML =
        '<div class="status-msg">📭 Không có dữ liệu tháng này</div>';
      return;
    }

    days = applySettingsOverrides(days, currentEmployeeId, month);
    renderAttendanceCalendar(days, month);
  } catch(e) {
    document.getElementById('attendanceContent').innerHTML =
      `<div class="status-msg">⚠ ${e.message}</div>`;
  }
}

// ── Áp dụng settings override lên từng ngày ─────────────
function applySettingsOverrides(days, empId, month) {
  const cfg = getSettings(empId, month);
  return days.map(d => recomputeStatus(d, cfg));
}

// ── Helpers ──────────────────────────────────────────────
function hhmm2mins(str) {
  if (!str) return null;
  const parts = str.split(':');
  if (parts.length < 2) return null;
  const h = parseInt(parts[0]), m = parseInt(parts[1]);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

function makeDateTime(dateStr, hhmm) {
  if (!dateStr || !hhmm) return null;
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, m]     = hhmm.split(':').map(Number);
  return new Date(y, mo - 1, d, h, m, 0);
}

// ── Tính lại trạng thái từng ngày ───────────────────────
function recomputeStatus(day, cfg) {
  const dateStr     = day.date;
  const dayOverride = cfg.overrides[dateStr] || {};

  // ── Xác định giờ ca cho ngày này ──────────────────────
  // Ưu tiên: override ngày > giờ ca chung (settings) > KHÔNG dùng giờ từ thiết bị
  // Lý do: giờ từ thiết bị (signInTime/signOutTime) là ca mặc định của hệ thống (VD: 08:00-17:00)
  // không phản ánh lịch thực tế của từng sinh viên.
  const signIn  = dayOverride.in  || cfg.signIn  || '';
  const signOut = dayOverride.out || cfg.signOut || '';

  // Không có ca nào được cài đặt → đánh dấu nghỉ, không tính trễ/vắng
  const hasSchedule = !!(signIn && signOut);

  const now      = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const dayDate  = new Date(dateStr + 'T00:00:00');
  const today    = new Date(todayStr + 'T00:00:00');

  // Ngày trong tương lai
  if (dayDate > today) {
    if (!hasSchedule) {
      return { ...day, signInTime: '', signOutTime: '', status: 'off', note: 'Không có ca' };
    }
    return {
      ...day,
      shiftType: 'normalShift',
      signInTime:  signIn,
      signOutTime: signOut,
      status: 'future',
      note:   'Chưa đến',
    };
  }

  // Ngày trong quá khứ / hôm nay nhưng không có ca → bỏ qua, hiện "Nghỉ"
  if (!hasSchedule) {
    // Nếu vẫn có check-in thực tế thì hiện đúng giờ dù không có ca cài đặt
    if (day.actualIn) {
      return {
        ...day,
        signInTime:  '',
        signOutTime: '',
        status: 'present',
        note:   `Check-in ${day.actualIn}${day.actualOut ? ' – ' + day.actualOut : ''} (không có ca đặt trước)`,
      };
    }
    return { ...day, signInTime: '', signOutTime: '', status: 'off', note: 'Không có ca' };
  }

  // Có ca — tính trạng thái dựa trên giờ thực tế
  const actualIn  = day.actualIn  || '';
  const actualOut = day.actualOut || '';
  const grace     = cfg.graceMinutes ?? 120;

  if (!actualIn) {
    // Chưa check-in: kiểm tra xem đã qua hạn chưa
    const deadlineMins = hhmm2mins(signIn) + grace;
    const deadlineH    = Math.floor(deadlineMins / 60) % 24;
    const deadlineM    = deadlineMins % 60;
    const deadlineStr  = `${String(deadlineH).padStart(2,'0')}:${String(deadlineM).padStart(2,'0')}`;
    const deadlineDt   = makeDateTime(dateStr, deadlineStr);

    if (now >= deadlineDt) {
      return {
        ...day,
        shiftType:   'normalShift',
        signInTime:  signIn,
        signOutTime: signOut,
        status: 'absent',
        note:   `Vắng – chưa check-in sau ${deadlineStr}`,
      };
    }
    return {
      ...day,
      shiftType:   'normalShift',
      signInTime:  signIn,
      signOutTime: signOut,
      status: 'future',
      note:   'Chưa check-in',
    };
  }

  // Có check-in — kiểm tra đi trễ
  let isLate = false, lateNote = '';
  const deadlineMins = hhmm2mins(signIn) + grace;
  const deadlineH    = Math.floor(deadlineMins / 60) % 24;
  const deadlineM    = deadlineMins % 60;
  const deadlineStr  = `${String(deadlineH).padStart(2,'0')}:${String(deadlineM).padStart(2,'0')}`;
  const deadlineDt   = makeDateTime(dateStr, deadlineStr);
  const actualInDt   = makeDateTime(dateStr, actualIn);

  if (actualInDt > deadlineDt) {
    isLate   = true;
    lateNote = `Đi trễ – vào ${actualIn} (hạn ${deadlineStr})`;
  }

  // Kiểm tra không check-out
  let isAbsentOut = false, absentNote = '';
  if (!actualOut && signOut) {
    const scheduledOutDt = makeDateTime(dateStr, signOut);
    if (now > scheduledOutDt) {
      isAbsentOut = true;
      absentNote  = `Vắng – không check-out (ca kết thúc ${signOut})`;
    }
  }

  let status, note;
  if (isAbsentOut) {
    status = 'absent_out';
    note   = absentNote + (isLate ? ` | ${lateNote}` : '');
  } else if (isLate) {
    status = 'late';
    note   = lateNote;
  } else {
    status = 'present';
    note   = 'Đúng giờ';
  }

  return {
    ...day,
    shiftType:   'normalShift',
    signInTime:  signIn,
    signOutTime: signOut,
    status,
    note,
  };
}

// ── Render lịch calendar ────────────────────────────────
function renderAttendanceCalendar(days, monthStr) {
  const [year, month] = monthStr.split('-').map(Number);
  const todayStr      = new Date().toISOString().split('T')[0];

  const lookup = {};
  days.forEach(d => { if (d.date) lookup[d.date] = d; });

  const cnt = { present: 0, late: 0, absent: 0, absent_out: 0, off: 0 };
  days.forEach(d => { const s = d.status; if (s in cnt) cnt[s]++; });

  const totalShift  = days.filter(d => d.shiftType === 'normalShift').length;
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDow    = new Date(year, month - 1, 1).getDay();
  const startBlank  = (firstDow + 6) % 7;
  const DOW         = ['T2','T3','T4','T5','T6','T7','CN'];

  let html = `
    <div class="att-summary">
      <div class="att-sum-card s-present"><div class="num">${cnt.present}</div><div class="lbl">Đúng giờ</div></div>
      <div class="att-sum-card s-late">   <div class="num">${cnt.late}</div>   <div class="lbl">Đi trễ</div></div>
      <div class="att-sum-card s-absent"> <div class="num">${cnt.absent + cnt.absent_out}</div><div class="lbl">Vắng/No-out</div></div>
      <div class="att-sum-card s-total">  <div class="num">${totalShift}</div> <div class="lbl">Ngày có ca</div></div>
      <div class="att-sum-card">          <div class="num">${daysInMonth}</div><div class="lbl">Tổng ngày</div></div>
    </div>
    <div class="cal-header">${DOW.map(d => `<div class="cal-dow">${d}</div>`).join('')}</div>
    <div class="cal-grid">`;

  for (let i = 0; i < startBlank; i++) html += '<div class="cal-day empty"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const info    = lookup[dateStr] || {};
    const status  = info.status || 'off';
    const cfg2    = STATUS_CFG[status] || STATUS_CFG.off;
    const isToday = dateStr === todayStr;

    let timeHtml = '';
    if (status === 'present' || status === 'late') {
      if (info.actualIn)  timeHtml += `<div class="cal-time">↓ ${info.actualIn}</div>`;
      if (info.actualOut) timeHtml += `<div class="cal-time">↑ ${info.actualOut}</div>`;
      else if (info.signOutTime) timeHtml += `<div class="cal-time" style="opacity:.5">↑ ${info.signOutTime}?</div>`;
    } else if (status === 'absent_out') {
      if (info.actualIn) timeHtml += `<div class="cal-time">↓ ${info.actualIn}</div>`;
      timeHtml += `<div class="cal-time">↑ —</div>`;
    } else if (status === 'future' && info.signInTime) {
      timeHtml += `<div class="cal-time" style="opacity:.5">${info.signInTime}–${info.signOutTime || '?'}</div>`;
    }

    const noteHtml = info.note
      ? `<div class="cal-note" title="${info.note}">${cfg2.label}</div>`
      : '';

    html += `
      <div class="cal-day ${cfg2.cls} ${isToday ? 'is-today' : ''}">
        <div class="cal-day-num">${d}</div>
        <div class="cal-status-icon">${cfg2.icon}</div>
        ${timeHtml}${noteHtml}
      </div>`;
  }

  html += `</div>
    <div class="cal-legend">
      <div class="leg-item"><div class="leg-dot" style="background:var(--accent-in)"></div> Đúng giờ</div>
      <div class="leg-item"><div class="leg-dot" style="background:var(--accent-yellow)"></div> Đi trễ</div>
      <div class="leg-item"><div class="leg-dot" style="background:var(--accent-out)"></div> Vắng mặt</div>
      <div class="leg-item"><div class="leg-dot" style="background:#f8c8c0"></div> Không check-out</div>
      <div class="leg-item"><div class="leg-dot" style="background:var(--border-dark)"></div> Nghỉ</div>
    </div>`;

  document.getElementById('attendanceContent').innerHTML = html;
}
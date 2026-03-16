// ═══════════════════════════════════════════════════════
//  ranking.js — Bảng xếp hạng tuần & Cảnh báo vắng nhiều
// ═══════════════════════════════════════════════════════

let rankingChart = null;
const ABSENT_THRESHOLD = 10; // Số ngày vắng tối thiểu để cảnh báo

// ── Fetch week events for ranking ────────────────────────
async function fetchWeekEvents() {
  const today   = new Date();
  const monday  = new Date(today);
  const dow     = today.getDay();
  monday.setDate(today.getDate() - ((dow + 6) % 7));

  const promises = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    if (d > today) break;
    const ds = d.toISOString().split('T')[0];
    promises.push(
      fetch(`${API_BASE}/api/events?date=${ds}`)
        .then(r => r.json())
        .then(j => (j.success ? j.events : []))
        .catch(() => [])
    );
  }

  const results = await Promise.all(promises);
  return results.flat();
}

// ── Update ranking từ MongoDB ────────────────────────────
async function updateRanking() {
  const tbody = document.getElementById('ranking-body');
  tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-dim);padding:16px"><div class="spinner" style="display:inline-block;margin-right:8px"></div>Đang tải...</td></tr>';

  try {
    const res  = await fetch(`${API_BASE}/api/ranking/week`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const rows = data.ranking || [];
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-dim);padding:16px">Chưa có dữ liệu tuần này</td></tr>';
      updateRankingChart([]);
      return;
    }

    const medals = ['🥇','🥈','🥉'];
    tbody.innerHTML = rows.map((r, i) => `
    <tr>
        <td>${i < 3
        ? `<span class="rank-medal">${medals[i]}</span>`
        : `<span class="rank-num">${i+1}</span>`}
        </td>
        <td>
            <div class="rank-name">${r.name}</div>
            <div class="rank-id">ID: ${r.empId}</div>
        </td>
        <td><span class="rank-hours">${r.display}</span></td>
    </tr>`).join('');

    updateRankingChart(rows);
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--text-dim);padding:12px">⚠ ${e.message}</td></tr>`;
  }
}

// ── Nút làm mới ranking ──────────────────────────────────
async function refreshRanking(btn) {
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    await fetch(`${API_BASE}/api/ranking/sync`, { method: 'POST' });
    await new Promise(r => setTimeout(r, 3000));
    await updateRanking();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻ Làm mới'; }
  }
}

// ── Cảnh báo vắng nhiều — fetch attendance từng người ────
  async function updateWarning() {
    const today = new Date().toISOString().split('T')[0];
    const month = today.slice(0, 7);
    const nowHour = new Date().getHours() + new Date().getMinutes() / 60;

    // Chưa 17h thì không check
    if (nowHour < 10) {
      renderWarningFromCache([]);
      return;
    }

    try {
      const res   = await fetch(`${API_BASE}/api/users`);
      const data  = await res.json();
      if (!data.success) return;

      const users = data.users.filter(u => String(u.id) !== '51');

      // Fetch attendance hôm nay cho tất cả
      const results = await Promise.all(users.map(async u => {
        try {
          const r    = await fetch(`${API_BASE}/api/attendance?id=${u.id}&month=${month}`);
          const json = await r.json();
          if (!json.success) return null;

          const todayRecord = json.days.find(d => d.date === today);
          if (!todayRecord) return null;

          // Chỉ báo nếu: normalShift + chưa check-in (absent hoặc future không có actualIn)
          const isScheduled = todayRecord.shiftType === 'normalShift';
          const noCheckIn   = !todayRecord.actualIn || todayRecord.actualIn === '';
          const notPresent  = todayRecord.status !== 'present' && todayRecord.status !== 'late';
          console.log(`[Warning] ${u.name}: date=${today}, shiftType=${todayRecord?.shiftType}, status=${todayRecord?.status}, actualIn=${todayRecord?.actualIn}`);
          if (isScheduled && noCheckIn) {
            return { id: u.id, name: u.name, faceURL: u.faceURL, date: today };
          }
          return null;
        } catch { return null; }
      }));

      const warnings = results.filter(Boolean);
      renderWarningFromCache(warnings);
      sendWarningMails(warnings, today);

    } catch(e) {
      console.error('updateWarning error:', e);
    }
  }

  function renderWarningFromCache(warnings) {
    const tbody = document.querySelector('#warning-body');
    if (!tbody) return;

    if (warnings.length === 0) {
      tbody.innerHTML = `<tr><td colspan="2">
        <div class="warning-empty">✅ Không có vắng mặt hôm nay</div>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = warnings.map(w => {
      const initial = (w.name || '?').charAt(0).toUpperCase();
      const faceHtml = w.faceURL
        ? `<img src="${w.faceURL}"
                style="width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid #e0dbd3;flex-shrink:0"
                onerror="this.outerHTML='<div style=\'width:44px;height:44px;border-radius:50%;background:var(--accent-blue-light);color:var(--accent-blue);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px\'>${initial}</div>'">`
        : `<div style="width:44px;height:44px;border-radius:50%;background:var(--accent-blue-light);color:var(--accent-blue);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;flex-shrink:0">${initial}</div>`;

      return `
        <tr>
          <td>
            <div style="display:flex;align-items:center;gap:10px;padding:4px 0">
              ${faceHtml}
              <div>
                <div class="warn-name">${w.name}</div>
                <div class="warn-id" style="font-size:11px;color:var(--text-dim)">ID: ${w.id}</div>
              </div>
            </div>
          </td>
          <td>
            <span class="warn-badge warn-badge-critical">Vắng hôm nay</span>
          </td>
        </tr>`;
    }).join('');
  }
async function sendWarningMails(warnings, today) {
  if (warnings.length === 0) return;
  try {
    const pRes  = await fetch(`${API_BASE}/api/student/profiles`);
    const pData = await pRes.json();
    if (!pData.success) return;

    const profileMap = {};
    pData.profiles.forEach(p => { profileMap[String(p.empId)] = p; });

    for (const w of warnings) {
      const profile = profileMap[String(w.id)];
      const email   = profile?.gmail || '';

      await fetch(`${API_BASE}/api/warning/send-mail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name:     w.name,
          absents:  1,
          empId:    String(w.id),
          month:    today,
          date:     today,
          testMode: true   // đổi false khi muốn gửi thật
        })
      });
    }
  } catch(e) {
    console.error('sendWarningMails error:', e);
  }
}
// ── Chart ────────────────────────────────────────────────
function updateRankingChart(rows) {
  const canvas = document.getElementById('rankingChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const top    = rows.slice(0, 8);
  const labels = top.map(r => r.name.split(' ').pop());
  const values = top.map(r => parseFloat((r.minutes / 60).toFixed(1)));

  const colors = [
    '#f4b942','#a8c5da','#d4956a',
    '#7ec8a4','#b49fd4','#f4917b',
    '#82c9d4','#cfd48a'
  ];

  if (rankingChart) rankingChart.destroy();

  rankingChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Giờ làm tuần này',
        data: values,
        backgroundColor: colors.slice(0, top.length),
        borderRadius: 8,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const h = Math.floor(ctx.raw);
              const m = Math.round((ctx.raw - h) * 60);
              return ` ${h}g ${m}p`;
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: {
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: {
            callback: v => `${v}g`,
            font: { size: 11 }
          }
        }
      }
    }
  });
}

// ── Init ─────────────────────────────────────────────────
updateRanking();
setTimeout(updateWarning, 2000);
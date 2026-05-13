#!/usr/bin/env python3
from flask import Flask, jsonify, send_from_directory, request, Response, session, redirect
from flask_cors import CORS
import requests
from requests.auth import HTTPDigestAuth
from datetime import datetime, date, timedelta, timezone
import json as json_lib
import urllib3
import threading
import time as time_mod
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
import os
import re
import random
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from functools import wraps
# ── MongoDB ──────────────────────────────────────────────────────────────────
from pymongo import MongoClient, ASCENDING

MONGO_URI = "mongodb://45.76.152.99:27017"
MONGO_DB  = "makerspace"

try:
    _mongo_client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
    _mongo_client.server_info()
    db_mongo     = _mongo_client[MONGO_DB]
    students_col = db_mongo["students"]
    hours_col    = db_mongo["daily_hours"]
    maillog_col  = db_mongo["mail_log"]
    schedule_col = db_mongo["schedules"]
    settings_col = db_mongo["attendance_settings"]
    settings_col.create_index([("empId", ASCENDING), ("month", ASCENDING)], unique=True)
    schedule_col.create_index([("empId", ASCENDING), ("month", ASCENDING)], unique=True)
    hours_col.create_index([("week",  ASCENDING), ("empId", ASCENDING)])
    hours_col.create_index([("date",  ASCENDING), ("empId", ASCENDING)], unique=True)
    print("[MongoDB] Kết nối thành công ✓")
except Exception as e:
    db_mongo = students_col = hours_col = maillog_col = schedule_col = settings_col = None
    print(f"[MongoDB] Không kết nối được: {e}")

# ─────────────────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder=BASE_DIR, static_url_path='')
CORS(app)
otp_store: dict = {} 
DEVICE_IP  = "192.168.1.66"
DEVICE_URL = f"https://{DEVICE_IP}/ISAPI/AccessControl/AcsEvent?format=json"
AUTH_USER  = "admin"
AUTH_PASS  = "Indruino@2024"
SMTP_HOST  = "smtp.gmail.com"
SMTP_PORT  = 587
SMTP_USER  = "conghoan191003@gmail.com"
SMTP_PASS  = "hrma mdru cwmw swsz"

REGISTER_ADMIN_PASS = "123456"
TZ_ICT = timezone(timedelta(hours=7))

SYNC_INTERVAL_SEC  = 5 * 60
LATE_GRACE_MINUTES = 120

# scheduleDB: dict = {}

# ─────────────────────────── helpers ────────────────────────────────────────

def get_ict_now() -> datetime:
    return datetime.now(tz=TZ_ICT)


def format_countdown(secs: int) -> str:
    d = secs // 86400
    h = (secs % 86400) // 3600
    m = (secs % 3600)  // 60
    parts = []
    if d: parts.append(f"{d} ngày")
    if h: parts.append(f"{h} giờ")
    parts.append(f"{m} phút")
    return " ".join(parts)


# ── Decorator: chỉ cần nhập đúng pass là vào được, không giới hạn ngày ─────
def require_register_access(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        # Chủ Nhật (weekday() == 6) → mở tự do, không cần pass
        now_ict = get_ict_now()
        if now_ict.weekday() == 6:
            return f(*args, **kwargs)

        admin_pass = (
            request.headers.get("X-Admin-Pass", "")
            or request.args.get("admin_pass", "")
            or request.cookies.get("admin_pass", "")
        )
        if admin_pass == REGISTER_ADMIN_PASS:
            return f(*args, **kwargs)

        # Bị chặn — trả về trang yêu cầu nhập pass
        if request.path.startswith("/api/"):
            return jsonify({
                "success": False,
                "closed":  True,
                "error":   "Vui lòng nhập mật khẩu để truy cập trang đăng ký.",
            }), 403

        html = _login_page()
        return Response(html, status=403, content_type="text/html; charset=utf-8")

    return decorated

def _login_page() -> str:
    return """<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Đăng nhập — Trang đăng ký</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@700;900&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg:#f5f3ef; --white:#fff; --navy:#1a2744;
    --border:#e0dbd3; --text:#1a1714; --text-dim:#9a9088;
    --accent-blue:#1a4a8a; --accent-blue-light:#e8eef7;
    --shadow-lg:0 8px 32px rgba(26,23,20,0.12);
  }
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:var(--bg);font-family:'Plus Jakarta Sans',sans-serif;min-height:100vh;
       display:flex;align-items:center;justify-content:center;padding:20px;}
  .box{
    background:var(--white);border:1.5px solid var(--border);
    border-radius:20px;padding:48px 40px;
    max-width:420px;width:100%;text-align:center;
    box-shadow:var(--shadow-lg);
  }
  .lock-icon{
    width:72px;height:72px;background:var(--navy);border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    font-size:32px;margin:0 auto 24px;
    box-shadow:0 0 0 8px rgba(26,39,68,0.08);
  }
  h1{font-family:'Fraunces',serif;font-size:22px;font-weight:900;
     color:var(--navy);margin-bottom:8px;}
  .subtitle{font-size:13px;color:var(--text-dim);margin-bottom:32px;line-height:1.6;}
  .input-wrap{text-align:left;margin-bottom:16px;}
  .input-label{font-family:'Space Mono',monospace;font-size:9px;font-weight:700;
               letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim);
               display:block;margin-bottom:8px;}
  .input-row{display:flex;gap:8px;}
  .pass-input{
    flex:1;padding:11px 14px;border:1.5px solid var(--border);border-radius:9px;
    font-family:'Plus Jakarta Sans',sans-serif;font-size:14px;color:var(--text);
    background:#f0ede8;outline:none;transition:border-color .2s;
  }
  .pass-input:focus{border-color:var(--accent-blue);background:#fff;}
  .btn{
    padding:11px 22px;background:var(--navy);color:#fff;
    border:none;border-radius:9px;font-family:'Plus Jakarta Sans',sans-serif;
    font-size:13px;font-weight:700;cursor:pointer;
    transition:background .2s,transform .15s;white-space:nowrap;
  }
  .btn:hover{background:#243560;transform:translateY(-1px);}
  .err{display:none;margin-top:10px;font-size:12px;color:#b5341a;
       font-family:'Space Mono',monospace;}
</style>
</head>
<body>
<div class="box">
  <div class="lock-icon">🔑</div>
  <h1>Trang đăng ký lịch</h1>
  <p class="subtitle">Nhập mật khẩu để truy cập trang đăng ký lịch làm việc.</p>
  <div class="input-wrap">
    <span class="input-label">Mật khẩu</span>
    <div class="input-row">
      <input type="password" class="pass-input" id="passInput"
             placeholder="Nhập mật khẩu..."
             onkeydown="if(event.key==='Enter') tryLogin()">
      <button class="btn" onclick="tryLogin()">Vào →</button>
    </div>
    <div class="err" id="errMsg">❌ Sai mật khẩu</div>
  </div>
</div>
<script>
  function tryLogin() {
    const pass = document.getElementById('passInput').value;
    if (!pass) return;
    window.location.href = '/?admin_pass=' + encodeURIComponent(pass);
  }
</script>
</body>
</html>"""


# ─────────────────────────── helpers ────────────────────────────────────────

def get_week_label(d: date) -> str:
    iso = d.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def parse_hhmm(hhmm: str):
    try:
        h, m = hhmm.strip().split(":")
        return datetime.strptime(f"{int(h):02d}:{int(m):02d}", "%H:%M").time()
    except Exception:
        return None


def device_url_to_proxy(face_url: str) -> str:
    if not face_url:
        return ""
    prefix = f"https://{DEVICE_IP}/"
    if not face_url.startswith(prefix):
        return face_url
    path = face_url[len(prefix):]
    if "@" in path:
        path_part, token = path.split("@", 1)
        return f"/api/face/{path_part}?token={token}"
    return f"/api/face/{path}"


def fetch_day_events(date_str: str):
    body_str = json_lib.dumps({
        "AcsEventCond": {
            "searchID": f"sync-{int(time_mod.time())}",
            "searchResultPosition": 0,
            "maxResults": 1000,
            "major": 0, "minor": 0,
            "startTime": f"{date_str}T00:00:00+07:00",
            "endTime":   f"{date_str}T22:00:00+07:00",
            "timeReverseOrder": True,
            "picEnable": False,
        }
    })
    try:
        resp = requests.post(
            DEVICE_URL, data=body_str,
            headers={"Content-Type": "application/json"},
            auth=HTTPDigestAuth(AUTH_USER, AUTH_PASS),
            timeout=15, verify=False
        )
        resp.raise_for_status()
        return resp.json().get("AcsEvent", {}).get("InfoList", [])
    except Exception as e:
        print(f"[Sync] fetch_day_events({date_str}) lỗi: {e}")
        return []


def calc_minutes_for_person(checkins: list, checkouts: list):
    if not checkins:
        return 0, "", ""
    checkins  = sorted(checkins)
    checkouts = sorted(checkouts)
    first_in_str = checkins[0].strftime("%H:%M")
    last_out_str = checkouts[-1].strftime("%H:%M") if checkouts else ""
    if not checkouts:
        return 0, first_in_str, ""
    total_secs = 0
    used_out   = set()
    for ci in checkins:
        idx = next(
            (i for i, co in enumerate(checkouts) if i not in used_out and co > ci),
            None
        )
        if idx is not None:
            used_out.add(idx)
            total_secs += (checkouts[idx] - ci).total_seconds()
    return round(total_secs / 60), first_in_str, last_out_str


# ─────────────────────────── background sync ────────────────────────────────

def sync_daily_hours(target_date: date = None):
    if hours_col is None:
        return
    d        = target_date or date.today()
    date_str = d.isoformat()
    week     = get_week_label(d)
    now_ict  = datetime.now(tz=TZ_ICT)
    print(f"[Sync] {date_str} (tuần {week}) ...")
    events = fetch_day_events(date_str)
    if not events:
        print(f"[Sync] Không có events ngày {date_str}")
        return
    by_person: dict = {}
    for ev in events:
        emp_id = ev.get("employeeNoString", "")
        name   = ev.get("name", "Unknown")
        status = ev.get("attendanceStatus", "")
        t_str  = ev.get("time", "")
        if emp_id == "51" or not status or not t_str:
            continue
        try:
            dt = datetime.fromisoformat(t_str)
        except Exception:
            continue
        if emp_id not in by_person:
            by_person[emp_id] = {"name": name, "checkins": [], "checkouts": []}
        if status == "checkIn":
            by_person[emp_id]["checkins"].append(dt)
        elif status == "checkOut":
            by_person[emp_id]["checkouts"].append(dt)
    upserted = 0
    for emp_id, data in by_person.items():
        minutes, ci_str, co_str = calc_minutes_for_person(
            data["checkins"], data["checkouts"]
        )
        hours_col.update_one(
            {"date": date_str, "empId": emp_id},
            {"$set": {
                "name":      data["name"],
                "week":      week,
                "minutes":   minutes,
                "checkIn":   ci_str,
                "checkOut":  co_str,
                "updatedAt": now_ict,
            }, "$setOnInsert": {
                "date":  date_str,
                "empId": emp_id,
            }},
            upsert=True
        )
        upserted += 1
    print(f"[Sync] Xong — {upserted} bản ghi cho {date_str}")


def _sync_loop():
    time_mod.sleep(10)
    sync_daily_hours()
    while True:
        time_mod.sleep(SYNC_INTERVAL_SEC)
        sync_daily_hours()


# ─────────────────────────── helpers – attendance ───────────────────────────

def get_actual_times(date_str: str, emp_id: str):
    body_str = json_lib.dumps({
        "AcsEventCond": {
            "searchID":             f"att-{emp_id}-{date_str}",
            "searchResultPosition": 0,
            "maxResults":           50,
            "major": 0, "minor": 0,
            "startTime": f"{date_str}T00:00:00+07:00",
            "endTime":   f"{date_str}T23:59:59+07:00",
            "timeReverseOrder": False,
            "picEnable": False,
            "employeeNoString": emp_id
        }
    })
    try:
        resp = requests.post(DEVICE_URL, data=body_str,
                             headers={"Content-Type": "application/json"},
                             auth=HTTPDigestAuth(AUTH_USER, AUTH_PASS),
                             timeout=10, verify=False)
        resp.raise_for_status()
        events = resp.json().get("AcsEvent", {}).get("InfoList", [])
    except Exception:
        return None, None
    checkins, checkouts = [], []
    for ev in events:
        t_str = ev.get("time", "")
        if not t_str:
            continue
        try:
            dt = datetime.fromisoformat(t_str)
        except Exception:
            continue
        s = ev.get("attendanceStatus", "")
        if s == "checkIn":   checkins.append(dt)
        elif s == "checkOut": checkouts.append(dt)
    return (min(checkins) if checkins else None,
            max(checkouts) if checkouts else None)


def compute_status(base: dict, today: date) -> dict:
    date_str   = base.get("date", "")
    shift_type = base.get("shiftType", "")
    emp_id     = base.get("employeeNo", "")

    if shift_type != "normalShift":
        return {**base, "status": "off", "actualIn": "", "actualOut": "", "note": "Ngày nghỉ"}

    try:
        day_date = date.fromisoformat(date_str)
    except Exception:
        return {**base, "status": "off", "actualIn": "", "actualOut": "", "note": "Lỗi ngày"}

    if day_date > today:
        return {**base, "status": "future", "actualIn": "", "actualOut": "", "note": "Chưa đến"}

    sign_in_t  = parse_hhmm(base.get("signInTime",  ""))
    sign_out_t = parse_hhmm(base.get("signOutTime", ""))

    # ── Ưu tiên đọc từ MongoDB (data đã sync) ────────────────────────────────
    first_in: datetime | None = None
    last_out: datetime | None = None

    if hours_col is not None:
        cached = hours_col.find_one({"date": date_str, "empId": emp_id})
        if cached:
            ci_str = cached.get("checkIn",  "")
            co_str = cached.get("checkOut", "")
            try:
                if ci_str:
                    first_in = datetime.combine(
                        day_date,
                        datetime.strptime(ci_str, "%H:%M").time(),
                        tzinfo=TZ_ICT
                    )
                if co_str:
                    last_out = datetime.combine(
                        day_date,
                        datetime.strptime(co_str, "%H:%M").time(),
                        tzinfo=TZ_ICT
                    )
            except Exception:
                pass

    # ── Nếu là hôm nay → query thiết bị để lấy data real-time mới nhất ──────
    if day_date == today:
        fi, lo = get_actual_times(date_str, emp_id)
        if fi:
            first_in = fi
        if lo:
            last_out = lo

    # ── Nếu cả 2 nguồn đều không có → fallback query thiết bị (ngày gần đây) ─
    if first_in is None and (today - day_date).days <= 3:
        fi, lo = get_actual_times(date_str, emp_id)
        if fi:
            first_in = fi
        if lo:
            last_out = lo

    actual_in_str  = first_in.strftime("%H:%M") if first_in  else ""
    actual_out_str = last_out.strftime("%H:%M") if last_out else ""

    now = datetime.now(tz=TZ_ICT)

    # ── Chưa check-in ────────────────────────────────────────────────────────
    if first_in is None:
        if sign_in_t:
            deadline = datetime.combine(day_date, sign_in_t, tzinfo=TZ_ICT) \
                       + timedelta(minutes=LATE_GRACE_MINUTES)
            if now >= deadline:
                return {
                    **base,
                    "status":    "absent",
                    "actualIn":  "",
                    "actualOut": "",
                    "note":      f"Vắng – chưa check-in sau {deadline.strftime('%H:%M')}",
                }
        return {
            **base,
            "status":    "future",
            "actualIn":  "",
            "actualOut": "",
            "note":      "Chưa check-in",
        }

    # ── Kiểm tra đi trễ ──────────────────────────────────────────────────────
    late_note = ""
    is_late   = False
    if sign_in_t:
        dl = datetime.combine(day_date, sign_in_t, tzinfo=TZ_ICT) \
             + timedelta(minutes=LATE_GRACE_MINUTES)
        if first_in > dl:
            is_late   = True
            late_note = f"Đi trễ – vào {actual_in_str} (hạn {dl.strftime('%H:%M')})"

    # ── Kiểm tra không check-out ─────────────────────────────────────────────
    # Chỉ đánh absent_out nếu:
    #   1. Không có checkout
    #   2. Ca đã kết thúc (now > scheduled_out)
    #   3. Là hôm nay HOẶC có trong MongoDB (ngày quá khứ chỉ phán nếu đã sync đủ)
    is_absent_out = False
    absent_note   = ""

    if last_out is None and sign_out_t:
        sched_out = datetime.combine(day_date, sign_out_t, tzinfo=TZ_ICT)
        if now > sched_out:
            # Ngày quá khứ (không phải hôm nay): chỉ đánh absent_out
            # nếu MongoDB có bản ghi cho ngày đó (tức là đã sync, checkout thực sự trống)
            if day_date == today:
                is_absent_out = True
                absent_note   = f"Vắng – không check-out (ca kết thúc {sign_out_t.strftime('%H:%M')})"
            elif hours_col is not None:
                cached_check = hours_col.find_one({"date": date_str, "empId": emp_id})
                if cached_check is not None:
                    # Bản ghi tồn tại trong DB nhưng checkOut trống → thực sự không checkout
                    is_absent_out = True
                    absent_note   = f"Vắng – không check-out (ca kết thúc {sign_out_t.strftime('%H:%M')})"
                # Nếu không có bản ghi DB → chưa sync, không phán

    # ── Tổng hợp trạng thái ──────────────────────────────────────────────────
    if is_absent_out:
        status = "absent_out"
        note   = absent_note + (f" | {late_note}" if is_late else "")
    elif is_late:
        status = "late"
        note   = late_note
    else:
        status = "present"
        note   = "Đúng giờ"

    return {
        **base,
        "status":    status,
        "actualIn":  actual_in_str,
        "actualOut": actual_out_str,
        "note":      note,
    }


# ─────────────────────────── routes – dashboard (port 5000) ─────────────────

@app.route('/')
def index():
    return send_from_directory(BASE_DIR, 'index.html')

@app.route('/register')
def register_page():
    return send_from_directory(BASE_DIR, 'register.html')

@app.route('/api/users')
def get_users():
    url = f"https://{DEVICE_IP}/ISAPI/AccessControl/UserInfo/Search?format=json"
    body_str = json_lib.dumps({
        "UserInfoSearchCond": {"searchID": "userlist", "maxResults": 100, "searchResultPosition": 0}
    })
    try:
        resp = requests.post(url, data=body_str, headers={"Content-Type": "application/json"},
                             auth=HTTPDigestAuth(AUTH_USER, AUTH_PASS), timeout=10, verify=False)
        resp.raise_for_status()
        users = resp.json().get("UserInfoSearch", {}).get("UserInfo", [])
        result = [{"id": u.get("employeeNo",""), "name": u.get("name",""),
                   "gender": u.get("gender","unknown"),
                   "faceURL": device_url_to_proxy(u.get("faceURL","")),
                   "numOfFace": u.get("numOfFace",0), "numOfFP": u.get("numOfFP",0)} for u in users]
        return jsonify({"success": True, "users": result, "total": len(result)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/face/<path:face_path>')
def proxy_face(face_path):
    token = request.args.get("token", "")
    device_url = f"https://{DEVICE_IP}/{face_path}" + (f"@{token}" if token else "")
    try:
        resp = requests.get(device_url, auth=HTTPDigestAuth(AUTH_USER, AUTH_PASS),
                            timeout=8, verify=False, stream=True)
        resp.raise_for_status()
        return Response(resp.content, content_type=resp.headers.get("Content-Type","image/jpeg"),
                        headers={"Cache-Control": "public, max-age=3600"})
    except requests.exceptions.HTTPError as e:
        return jsonify({"error": str(e)}), 404
    except requests.exceptions.Timeout:
        return jsonify({"error": "Timeout"}), 504
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/user_count')
def user_count():
    url  = f"https://{DEVICE_IP}/ISAPI/AccessControl/UserInfo/Search?format=json"
    body = {"UserInfoSearchCond": {"searchID":"count","maxResults":1,"searchResultPosition":0}}
    resp = requests.post(url, json=body, auth=HTTPDigestAuth(AUTH_USER, AUTH_PASS), verify=False)
    return jsonify({"total_users": resp.json().get("UserInfoSearch",{}).get("totalMatches",0)})

@app.route('/api/attendance')
def get_attendance():
    emp_id = request.args.get('id','').strip()
    month  = request.args.get('month', datetime.now().strftime('%Y-%m'))
    if not emp_id:
        return jsonify({"success": False, "error": "Thiếu tham số id"}), 400
    url = f"https://{DEVICE_IP}/ISAPI/AccessControl/LocalAttendance/SearchPersonShiftOverview?format=json"
    body_str = json_lib.dumps({"searchID":"attendance-overview","searchResultPosition":0,
                                "maxResults":31,"shiftSummaryMethod":"month","month":month,"employeeNo":emp_id})
    try:
        resp = requests.post(url, data=body_str, headers={"Content-Type":"application/json"},
                             auth=HTTPDigestAuth(AUTH_USER, AUTH_PASS), timeout=10, verify=False)
        resp.raise_for_status()
        raw = resp.json()
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    today = date.today(); days = []
    for item in raw.get("matchResults", []):
        shift_type = item.get("shiftType",""); sign_in = sign_out = ""
        if shift_type == "normalShift":
            for tr in item.get("NormalShift",{}).get("TimeRangeList",[]):
                si = tr.get("signInTime","00:00"); so = tr.get("signOutTime","00:00")
                if si != "00:00" or so != "00:00":
                    sign_in, sign_out = si, so; break
        base = {"date":item.get("date",""),"shiftType":shift_type,
                "signInTime":sign_in,"signOutTime":sign_out,"employeeNo":emp_id}
        enriched = compute_status(base, today); enriched.pop("employeeNo", None)
        days.append(enriched)
    return jsonify({"success": True, "employeeNo": emp_id, "month": month, "days": days})

@app.route('/api/events')
def get_events():
    date_str = request.args.get('date', datetime.now().strftime('%Y-%m-%d'))
    body_str = json_lib.dumps({"AcsEventCond": {
        "searchID":"checkin-today","searchResultPosition":0,"maxResults":100,
        "major":0,"minor":0,"startTime":f"{date_str}T07:00:00+07:00",
        "endTime":f"{date_str}T22:00:00+07:00","timeReverseOrder":True,"picEnable":False}})
    try:
        resp = requests.post(DEVICE_URL, data=body_str, headers={"Content-Type":"application/json"},
                             auth=HTTPDigestAuth(AUTH_USER, AUTH_PASS), timeout=10, verify=False)
        resp.raise_for_status()
        events = resp.json().get("AcsEvent",{}).get("InfoList",[])
        result = []
        for ev in sorted(events, key=lambda x: x.get("time",""), reverse=True):
            status = ev.get("attendanceStatus","")
            if not status: continue
            result.append({"id":ev.get("employeeNoString",""),"name":ev.get("name","Unknown"),
                           "time":ev.get("time",""),"status":status,
                           "label":ev.get("label",status.title()),"serialNo":ev.get("serialNo")})
        return jsonify({"success": True, "events": result, "total": len(events)})
    except requests.exceptions.ConnectionError:
        return jsonify({"success": False, "error": f"Không kết nối được thiết bị tại {DEVICE_IP}"}), 503
    except requests.exceptions.Timeout:
        return jsonify({"success": False, "error": "Thiết bị timeout"}), 504
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/ranking/week')
def get_ranking_week():
    if hours_col is None:
        return jsonify({"success": False, "error": "MongoDB chưa kết nối"}), 503
    week = request.args.get('week', get_week_label(date.today()))
    pipeline = [
        {"$match": {"week": week, "minutes": {"$gt": 0}}},
        {"$group": {"_id": "$empId", "name": {"$last": "$name"}, "total": {"$sum": "$minutes"}}},
        {"$sort": {"total": -1}},
    ]
    rows   = list(hours_col.aggregate(pipeline))
    result = []
    for r in rows:
        mins = r["total"]; h = mins // 60; m = mins % 60
        result.append({"empId": r["_id"], "name": r["name"], "minutes": mins,
                        "display": f"{h}g {m}p" if h > 0 else f"{m}p"})
    return jsonify({"success": True, "week": week, "ranking": result})

@app.route('/api/ranking/sync', methods=['POST'])
def trigger_sync():
    target = request.args.get('date', date.today().isoformat())
    try:
        d = date.fromisoformat(target)
    except Exception:
        return jsonify({"success": False, "error": "date không hợp lệ"}), 400
    threading.Thread(target=sync_daily_hours, args=(d,), daemon=True).start()
    return jsonify({"success": True, "message": f"Đang sync {target}..."})

@app.route('/api/ranking/reset', methods=['POST'])
def reset_week():
    if hours_col is None:
        return jsonify({"success": False, "error": "MongoDB chưa kết nối"}), 503
    body = request.get_json(silent=True) or {}
    if body.get("secret") != "makerspace2024":
        return jsonify({"success": False, "error": "Sai secret key"}), 403
    week = body.get("week", get_week_label(date.today()))
    res  = hours_col.delete_many({"week": week})
    return jsonify({"success": True, "week": week, "deleted": res.deleted_count})

@app.route('/api/schedule', methods=['GET'])
def get_schedule():
    emp_id = request.args.get('empId','').strip()
    month  = request.args.get('month','').strip()
    if not emp_id or not month:
        return jsonify({"success": False, "error": "Thiếu empId hoặc month"}), 400
    
    if schedule_col is None:
        return jsonify({"success": False, "error": "MongoDB chưa kết nối"}), 503
    
    doc  = schedule_col.find_one({"empId": emp_id, "month": month}, {"_id": 0})
    days = doc.get("days", {}) if doc else {}
    return jsonify({"success": True, "empId": emp_id, "month": month, "days": days, "count": len(days)})


@app.route('/api/schedule', methods=['POST'])
def save_schedule():
    body   = request.get_json(silent=True) or {}
    emp_id = body.get('empId','').strip()
    month  = body.get('month','').strip()
    days   = body.get('days', {})
    print(f"[Schedule] POST empId={emp_id} month={month} days={len(days)}")
    if not emp_id or not month:
        return jsonify({"success": False, "error": "Thiếu empId hoặc month"}), 400
    
    if schedule_col is None:
        print("[Schedule] ❌ schedule_col is None!")
        return jsonify({"success": False, "error": "MongoDB chưa kết nối"}), 503

    cleaned = {}
    for ds, times in days.items():
        if not isinstance(times, dict): continue
        it = times.get('in','').strip()
        ot = times.get('out','').strip()
        if it and ot:
            cleaned[ds] = {"in": it, "out": ot}
    
    schedule_col.update_one(
        {"empId": emp_id, "month": month},
        {"$set":         {"days": cleaned, "updatedAt": datetime.now(timezone.utc)},
         "$setOnInsert": {"empId": emp_id, "month": month, "createdAt": datetime.now(timezone.utc)}},
        upsert=True
    )
    return jsonify({"success": True, "empId": emp_id, "month": month,
                    "saved": len(cleaned), "message": f"Đã lưu {len(cleaned)} ngày"})

@app.route('/api/student/profile', methods=['POST'])
def save_student_profile():
    if students_col is None: return jsonify({"success": False, "error": "MongoDB chưa kết nối"}), 503
    data = request.get_json(force=True) or {}
    emp_id = str(data.get("empId","")).strip()
    if not emp_id: return jsonify({"success": False, "error": "Thiếu empId"}), 400
    upd = {"updatedAt": datetime.now(timezone.utc)}
    for f in ("avatar","gmail","phone","name"):
        if data.get(f): upd[f] = data[f]
    students_col.update_one({"empId": emp_id},
        {"$set": upd, "$setOnInsert": {"empId": emp_id, "createdAt": datetime.now(timezone.utc)}}, upsert=True)
    return jsonify({"success": True, "empId": emp_id})

@app.route('/api/student/profile/<emp_id>', methods=['GET'])
def get_student_profile(emp_id):
    if students_col is None: return jsonify({"success": False, "error": "MongoDB chưa kết nối"}), 503
    doc = students_col.find_one({"empId": str(emp_id)}, {"_id": 0})
    if not doc: return jsonify({"success": False, "error": "Không tìm thấy"}), 404
    return jsonify({"success": True, "profile": doc})

@app.route('/api/student/profiles', methods=['GET'])
def get_all_student_profiles():
    if students_col is None: return jsonify({"success": False, "error": "MongoDB chưa kết nối"}), 503
    return jsonify({"success": True, "profiles": list(students_col.find({}, {"_id": 0}))})

@app.route('/api/warning/send-mail', methods=['POST'])
def send_warning_mail():
    body      = request.get_json(silent=True) or {}
    to_email  = body.get('email', '')
    name      = body.get('name', '')
    absents   = body.get('absents', 0)
    emp_id    = body.get('empId', '')
    test_mode = body.get('testMode', True)
    recipient = SMTP_USER if test_mode else to_email
    if not recipient:
        return jsonify({"success": False, "error": "Không có email"}), 400
    today_str = date.today().isoformat()
    if maillog_col is not None:
        already = maillog_col.find_one({"empId": emp_id, "date": today_str})
        if already:
            return jsonify({"success": True, "skipped": True, "reason": f"Đã gửi lúc {already.get('sentAt','?')}"})
    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = f"⚠️ Cảnh báo vắng mặt - {name}"
        msg['From']    = f"Maker Space <{SMTP_USER}>"
        msg['To']      = recipient
        html_body = f"""
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e0dbd3">
          <div style="background:#1a2744;padding:28px 32px">
            <h2 style="color:#fff;margin:0;font-size:20px">⚠️ Cảnh báo vắng mặt</h2>
            <p style="color:rgba(255,255,255,0.6);margin:6px 0 0;font-size:13px">Maker Space — Hệ thống điểm danh</p>
          </div>
          <div style="padding:28px 32px">
            <p style="font-size:15px;color:#1a1714">Xin chào <strong>{name}</strong>,</p>
            <p style="color:#5a5147;line-height:1.7">
              Hệ thống ghi nhận bạn đã <strong style="color:#b5341a">không check-in ngày {body.get('date','hôm nay')}</strong> tại Maker Space.
            </p>
            <div style="background:#fdf0ed;border:1.5px solid #f0b8b0;border-radius:10px;padding:18px 22px;margin:20px 0">
              <div style="font-size:13px;color:#9a9088;margin-bottom:4px">Số ngày vắng</div>
              <div style="font-size:36px;font-weight:700;color:#b5341a;line-height:1">{absents}</div>
              <div style="font-size:12px;color:#9a9088;margin-top:4px">ngày trong tháng {body.get('month','')}</div>
            </div>
            {'<p style="font-size:11px;color:#9a9088;background:#f5f3ef;padding:8px 12px;border-radius:6px">[TEST MODE] Email thật sẽ gửi tới: ' + to_email + '</p>' if test_mode else ''}
          </div>
          <div style="background:#f5f3ef;padding:16px 32px;font-size:11px;color:#9a9088">
            Maker Space · ID sinh viên: {emp_id}
          </div>
        </div>"""
        msg.attach(MIMEText(html_body, 'html'))
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_USER, recipient, msg.as_string())
        if maillog_col is not None:
            now_ict = datetime.now(tz=TZ_ICT)
            maillog_col.update_one(
                {"empId": emp_id, "date": today_str},
                {"$set": {"name": name, "sentTo": recipient, "absents": absents,
                          "testMode": test_mode, "sentAt": now_ict.strftime("%H:%M:%S")}},
                upsert=True
            )
        return jsonify({"success": True, "sentTo": recipient, "testMode": test_mode})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
@app.route('/api/otp/send', methods=['POST'])
def send_otp():
    body   = request.get_json(silent=True) or {}
    emp_id = str(body.get('empId', '')).strip()
    gmail  = str(body.get('gmail', '')).strip()
    if not emp_id or not gmail:
        return jsonify({"success": False, "error": "Thiếu empId hoặc gmail"}), 400
    if not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', gmail):
        return jsonify({"success": False, "error": "Gmail không hợp lệ"}), 400

    otp     = str(random.randint(100000, 999999))
    expire  = datetime.now(tz=TZ_ICT) + timedelta(minutes=10)
    otp_store[emp_id] = {"otp": otp, "gmail": gmail, "expire": expire}

    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = f"🔐 Mã xác nhận Maker Space: {otp}"
        msg['From']    = f"Maker Space <{SMTP_USER}>"
        msg['To']      = gmail
        html_body = f"""
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e0dbd3">
          <div style="background:#1a2744;padding:26px 30px">
            <h2 style="color:#fff;margin:0;font-size:19px">🔐 Xác nhận Gmail</h2>
            <p style="color:rgba(255,255,255,0.5);margin:5px 0 0;font-size:12px">Maker Space · Đăng ký lịch làm việc</p>
          </div>
          <div style="padding:28px 30px">
            <p style="color:#1a1714;font-size:14px">Mã OTP của bạn là:</p>
            <div style="background:#e8f5ee;border:2px solid #7dc8a0;border-radius:12px;padding:20px;text-align:center;margin:16px 0">
              <div style="font-size:42px;font-weight:900;color:#1a6b3c;letter-spacing:10px;font-family:monospace">{otp}</div>
            </div>
            <p style="color:#9a9088;font-size:12px">Mã có hiệu lực trong <strong>10 phút</strong>. Không chia sẻ mã này cho người khác.</p>
          </div>
          <div style="background:#f5f3ef;padding:14px 30px;font-size:11px;color:#9a9088">Maker Space · ID: {emp_id}</div>
        </div>"""
        msg.attach(MIMEText(html_body, 'html'))
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_USER, gmail, msg.as_string())
        return jsonify({"success": True, "message": f"Đã gửi OTP tới {gmail}"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/otp/verify', methods=['POST'])
def verify_otp():
    body   = request.get_json(silent=True) or {}
    emp_id = str(body.get('empId', '')).strip()
    otp    = str(body.get('otp', '')).strip()
    if not emp_id or not otp:
        return jsonify({"success": False, "error": "Thiếu empId hoặc otp"}), 400
    record = otp_store.get(emp_id)
    if not record:
        return jsonify({"success": False, "error": "Chưa gửi OTP hoặc OTP đã hết hạn"}), 400
    if datetime.now(tz=TZ_ICT) > record["expire"]:
        otp_store.pop(emp_id, None)
        return jsonify({"success": False, "error": "OTP đã hết hạn, vui lòng gửi lại"}), 400
    if otp != record["otp"]:
        return jsonify({"success": False, "error": "OTP không đúng"}), 400
    otp_store.pop(emp_id, None)
    return jsonify({"success": True, "gmail": record["gmail"]})
@app.route('/api/settings/<emp_id>/<month>', methods=['GET'])
def get_settings_api(emp_id, month):
    if settings_col is None:
        return jsonify({"success": False, "error": "MongoDB chưa kết nối"}), 503
    doc = settings_col.find_one({"empId": emp_id, "month": month}, {"_id": 0})
    return jsonify({"success": True, "settings": doc or {}})

@app.route('/api/settings', methods=['POST'])
def save_settings_api():
    if settings_col is None:
        return jsonify({"success": False, "error": "MongoDB chưa kết nối"}), 503
    body   = request.get_json(silent=True) or {}
    emp_id = str(body.get("empId","")).strip()
    month  = str(body.get("month","")).strip()
    if not emp_id or not month:
        return jsonify({"success": False, "error": "Thiếu empId hoặc month"}), 400
    
    # Chỉ lưu các field settings, không lưu empId/month vào $set
    cfg_data = {
        "signIn":       body.get("signIn", ""),
        "signOut":      body.get("signOut", ""),
        "graceMinutes": body.get("graceMinutes", 120),
        "overrides":    body.get("overrides", {}),
        "updatedAt":    datetime.now(timezone.utc),
    }
    settings_col.update_one(
        {"empId": emp_id, "month": month},
        {"$set": cfg_data,
         "$setOnInsert": {"empId": emp_id, "month": month, "createdAt": datetime.now(timezone.utc)}},
        upsert=True
    )
    return jsonify({"success": True})
# ─────────────────────────── register_app (port 5001) ───────────────────────

DASHBOARD_PORT = 5000
REGISTER_PORT  = 5001

from flask import Flask as _Flask
register_app = _Flask('register_app', static_folder=BASE_DIR)
CORS(register_app)


@register_app.route('/')
@require_register_access
def _reg_index():
    return send_from_directory(BASE_DIR, 'register.html')

@register_app.route('/api/access-status')
def _reg_access_status():
    """Endpoint để frontend kiểm tra trạng thái pass."""
    admin_pass = (
        request.headers.get("X-Admin-Pass", "")
        or request.args.get("admin_pass", "")
        or request.cookies.get("admin_pass", "")
    )
    if admin_pass == REGISTER_ADMIN_PASS:
        return jsonify({"open": True, "message": "Đã xác thực, trang đăng ký mở."})
    return jsonify({"open": False, "message": "Vui lòng nhập mật khẩu để truy cập."}), 403

@register_app.route('/api/users')
def _reg_users():
    return get_users()

@register_app.route('/api/schedule', methods=['GET'])
def _reg_schedule_get():
    return get_schedule()

@register_app.route('/api/schedule', methods=['POST'])
def _reg_schedule_post():
    return save_schedule()

@register_app.route('/api/student/profile', methods=['POST'])
def _reg_save_profile():
    return save_student_profile()

@register_app.route('/api/student/profile/<emp_id>', methods=['GET'])
def _reg_get_profile(emp_id):
    return get_student_profile(emp_id)

# Static files (css/js) không cần kiểm soát access
@register_app.route('/<path:filename>')
def _reg_static(filename):
    return send_from_directory(BASE_DIR, filename)
@register_app.route('/api/otp/send', methods=['POST'])
def _reg_otp_send():
    return send_otp()

@register_app.route('/api/otp/verify', methods=['POST'])
def _reg_otp_verify():
    return verify_otp()
@register_app.route('/api/settings/<emp_id>/<month>', methods=['GET'])
def _reg_get_settings(emp_id, month):
    return get_settings_api(emp_id, month)

@register_app.route('/api/settings', methods=['POST'])
def _reg_save_settings():
    return save_settings_api()
# ─────────────────────────── main ───────────────────────────────────────────

if __name__ == '__main__':
    threading.Thread(target=_sync_loop, daemon=True).start()

    def run_register():
        import logging; logging.getLogger('werkzeug').setLevel(logging.WARNING)
        register_app.run(host='0.0.0.0', port=REGISTER_PORT, debug=False, use_reloader=False)

    threading.Thread(target=run_register, daemon=True).start()

    now_ict = get_ict_now()

    print("=" * 55)
    print("  Access Control Dashboard")
    print(f"  Thiet bi   : https://{DEVICE_IP}")
    print(f"  Dashboard  : http://localhost:{DASHBOARD_PORT}")
    print(f"  Dang ky    : http://localhost:{REGISTER_PORT}  🔑 YÊU CẦU MẬT KHẨU")
    print(f"  Admin pass : {REGISTER_ADMIN_PASS}")
    print(f"  Gio hien tai : {now_ict.strftime('%A %d/%m/%Y %H:%M')} ICT")
    print("  MongoDB    :", "Connected" if db_mongo is not None else "Offline")
    print(f"  Sync       : mỗi {SYNC_INTERVAL_SEC // 60} phút")
    print("=" * 55)
    app.run(host='0.0.0.0', port=DASHBOARD_PORT, debug=True, use_reloader=False)
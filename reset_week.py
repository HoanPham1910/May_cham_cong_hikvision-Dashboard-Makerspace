#!/usr/bin/env python3
"""
reset_week.py — Xóa dữ liệu giờ tuần trong MongoDB
Chạy tay hoặc schedule tự động vào thứ 2 đầu tuần.

Cách dùng:
  python reset_week.py                  → xóa tuần HIỆN TẠI
  python reset_week.py --week 2026-W11  → xóa tuần cụ thể
  python reset_week.py --auto           → tự động chạy vào 00:05 thứ 2

Build .exe:
  pip install pyinstaller
  pyinstaller --onefile reset_week.py
  → file .exe trong thư mục dist/
"""

import argparse
import sys
import time
from datetime import date, datetime, timezone, timedelta

try:
    from pymongo import MongoClient
except ImportError:
    print("Thiếu pymongo. Chạy: pip install pymongo")
    sys.exit(1)

# ── Cấu hình ────────────────────────────────────────────
MONGO_URI  = "mongodb://localhost:27017"
MONGO_DB   = "makerspace"
COLLECTION = "daily_hours"
SECRET     = "makerspace2024"   # giữ nguyên với app.py
TZ_ICT     = timezone(timedelta(hours=7))


def get_week_label(d: date) -> str:
    iso = d.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def connect():
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    client.server_info()
    return client[MONGO_DB][COLLECTION]


def reset(week: str, col):
    res = col.delete_many({"week": week})
    print(f"✓ Đã xóa {res.deleted_count} bản ghi của tuần {week}")


def preview(week: str, col):
    """Hiển thị tóm tắt trước khi xóa."""
    pipeline = [
        {"$match": {"week": week}},
        {"$group": {"_id": "$empId", "name": {"$last": "$name"},
                    "total": {"$sum": "$minutes"}, "days": {"$sum": 1}}},
        {"$sort": {"total": -1}},
    ]
    rows = list(col.aggregate(pipeline))
    if not rows:
        print(f"Không có dữ liệu cho tuần {week}")
        return False
    print(f"\n📋 Dữ liệu tuần {week} ({len(rows)} sinh viên):")
    print(f"{'Tên':<30} {'Ngày':>5} {'Tổng giờ':>10}")
    print("-" * 50)
    for r in rows:
        h = r['total'] // 60; m = r['total'] % 60
        print(f"{r['name']:<30} {r['days']:>5}    {h}g{m}p")
    print()
    return True


def auto_mode(col):
    """Tự động reset vào 00:05 thứ 2 hàng tuần."""
    print("⏰ Chế độ tự động — chờ đến thứ 2 00:05 ICT để reset...")
    while True:
        now  = datetime.now(tz=TZ_ICT)
        secs = time.time()
        # Thứ 2 = weekday() == 0
        if now.weekday() == 0 and now.hour == 0 and now.minute >= 5:
            # Tính tuần vừa kết thúc (tuần trước)
            last_week_date = now.date() - timedelta(days=7)
            week = get_week_label(last_week_date)
            print(f"\n[{now.strftime('%Y-%m-%d %H:%M')}] Reset tuần {week}...")
            try:
                reset(week, col)
            except Exception as e:
                print(f"Lỗi: {e}")
            # Ngủ đến thứ 2 tuần sau
            time.sleep(7 * 24 * 3600 - 60)
        else:
            # Tính thời gian đến thứ 2 00:05 tiếp theo
            days_until_monday = (7 - now.weekday()) % 7
            if days_until_monday == 0 and (now.hour > 0 or now.minute >= 5):
                days_until_monday = 7
            target = datetime(now.year, now.month, now.day,
                              0, 5, 0, tzinfo=TZ_ICT) + timedelta(days=days_until_monday)
            wait_secs = (target - now).total_seconds()
            h = int(wait_secs // 3600); m = int((wait_secs % 3600) // 60)
            print(f"  → Còn {h}g {m}p đến thứ 2 00:05. Đang chờ...", end='\r')
            time.sleep(60)


def main():
    parser = argparse.ArgumentParser(description="Reset dữ liệu giờ tuần trong MongoDB")
    parser.add_argument('--week', default='', help="Tuần cần xóa, vd: 2026-W11 (mặc định: tuần hiện tại)")
    parser.add_argument('--auto', action='store_true', help="Chạy daemon, tự reset mỗi thứ 2")
    parser.add_argument('--yes',  action='store_true', help="Bỏ qua xác nhận")
    args = parser.parse_args()

    print("=" * 50)
    print("  Reset Weekly Hours — Makerspace")
    print("=" * 50)

    try:
        col = connect()
        print("✓ Kết nối MongoDB thành công\n")
    except Exception as e:
        print(f"✗ Không kết nối được MongoDB: {e}")
        sys.exit(1)

    if args.auto:
        auto_mode(col)
        return

    week = args.week or get_week_label(date.today())
    has_data = preview(week, col)

    if not has_data:
        input("Nhấn Enter để thoát...")
        return

    if not args.yes:
        confirm = input(f"Xóa toàn bộ dữ liệu tuần {week}? (gõ 'yes' để xác nhận): ")
        if confirm.strip().lower() != 'yes':
            print("Đã hủy.")
            input("Nhấn Enter để thoát...")
            return

    reset(week, col)
    input("\nNhấn Enter để thoát...")


if __name__ == '__main__':
    main()
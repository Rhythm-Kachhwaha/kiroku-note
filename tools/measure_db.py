import glob
import os
import sqlite3
import tempfile
from pathlib import Path

# 1. Inspect bundled static databases
for path in sorted(glob.glob("backend/app/data/*.sqlite")):
    conn = sqlite3.connect(path)
    cur = conn.cursor()
    tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    print(f"=== Bundled DB: {path} ===")
    for t in sorted(tables):
        count = cur.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
        print(f"  {t}: {count}")
    conn.close()

# Check kiroku_dict.sqlite
for p in ["kiroku_dict.sqlite", "backend/kiroku_dict.sqlite"]:
    if os.path.exists(p):
        conn = sqlite3.connect(p)
        cur = conn.cursor()
        tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
        print(f"\n=== Local Dict DB: {p} ===")
        for t in sorted(tables):
            count = cur.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
            print(f"  {t}: {count}")
        conn.close()

# 2. Check seeded temp DB (kiroku.db and study.db)
tmpdir = tempfile.mkdtemp(prefix="kiroku_measure_")
try:
    os.environ["KIROKU_DATA_DIR"] = tmpdir
    from app.db.connection import init_db
    init_db()
    
    conn = sqlite3.connect(os.path.join(tmpdir, "kiroku.db"))
    cur = conn.cursor()
    tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    print(f"\n=== Fresh kiroku.db schema in {tmpdir} ===")
    for t in sorted(tables):
        count = cur.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
        print(f"  {t}: {count}")
    conn.close()
    
    # Study DB
    from app.study.connection import StudyDatabaseManager
    from app.study.migrations.runner import run_migrations
    study_db_path = Path(tmpdir) / "study.db"
    s_mgr = StudyDatabaseManager(study_db_path)
    s_conn = s_mgr.get_connection()
    run_migrations(s_conn)
    
    s_cur = s_conn.cursor()
    s_tables = [r[0] for r in s_cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    print(f"\n=== Migrated study.db schema ===")
    for t in sorted(s_tables):
        count = s_cur.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
        print(f"  {t}: {count}")
    s_conn.close()
finally:
    import shutil
    try:
        shutil.rmtree(tmpdir)
    except Exception:
        pass

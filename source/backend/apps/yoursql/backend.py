"""
YourSQL — MySQL manager backend for mvmOS.
Routes: /api/apps/yoursql/...
Uses the mysql CLI instead of pymysql — works on any machine without extra dependencies.
"""

import json
import os
import subprocess
import sqlite3
import sys

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from typing import Optional

get_current_session = sys.modules["backend.auth"].get_current_session

router = APIRouter(prefix="/api/apps/yoursql")
router._app_backend = "yoursql"

# App-own SQLite DB — stored in apps/yoursql/data.db
_DB_PATH = os.path.join(
    os.path.dirname(sys.modules["backend.db"].APPS_DIR),
    "apps", "yoursql", "data.db"
)


def _app_conn():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS connections (
            id TEXT PRIMARY KEY,
            user TEXT NOT NULL,
            name TEXT NOT NULL,
            host TEXT NOT NULL DEFAULT 'localhost',
            port INTEGER NOT NULL DEFAULT 3306,
            db_user TEXT NOT NULL,
            password TEXT NOT NULL DEFAULT '',
            database TEXT NOT NULL DEFAULT '',
            created_at INTEGER DEFAULT (strftime('%s','now'))
        )
    """)
    conn.commit()
    return conn


# ── mvmApps SQLite helper ─────────────────────────────────────────────────────

_APPS_ROOT = os.path.join(os.path.dirname(sys.modules["backend.db"].APPS_DIR), "apps")
_BACKEND_APPS_ROOT = os.path.join(os.path.dirname(sys.modules["backend.db"].APPS_DIR), "backend", "apps")
_CORE_DB_PATH = os.path.join(os.path.dirname(sys.modules["backend.db"].APPS_DIR), "data.db")
_MVMAPPS_CONN_ID = "__mvmapps__"
_CORE_CONN_ID = "__mvmcore__"


def _sqlite_db_path(database: str) -> str:
    """Resolve app name → SQLite path. Checks apps/ then backend/apps/."""
    for root in [_APPS_ROOT, _BACKEND_APPS_ROOT]:
        path = os.path.realpath(os.path.join(root, database, "data.db"))
        if path.startswith(os.path.realpath(root)) and os.path.exists(path):
            return path
    raise HTTPException(404, f"No database for app '{database}'")


def _resolve_sqlite_path(conn_id: str, database: str) -> str:
    if conn_id == _CORE_CONN_ID:
        return _CORE_DB_PATH
    return _sqlite_db_path(database)


def _sqlite_query_path(path: str, sql: str) -> dict:
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    try:
        cur = con.execute(sql)
        if sql.strip().upper().startswith(("SELECT", "PRAGMA", "EXPLAIN")):
            rows_raw = cur.fetchall()
            columns = list(rows_raw[0].keys()) if rows_raw else [d[0] for d in (cur.description or [])]
            return {"columns": columns, "rows": [dict(r) for r in rows_raw], "affected": None}
        else:
            con.commit()
            return {"columns": [], "rows": [], "affected": cur.rowcount}
    finally:
        con.close()


def _sqlite_query(database: str, sql: str) -> dict:
    """Run any SQL on a SQLite db. Returns {columns, rows, affected}."""
    path = _sqlite_db_path(database)
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    try:
        cur = con.execute(sql)
        sql_upper = sql.strip().upper()
        if sql_upper.startswith(("SELECT", "PRAGMA", "EXPLAIN")):
            rows_raw = cur.fetchall()
            if rows_raw:
                columns = list(rows_raw[0].keys())
                rows = [dict(r) for r in rows_raw]
            else:
                columns = [d[0] for d in (cur.description or [])]
                rows = []
            return {"columns": columns, "rows": rows, "affected": None}
        else:
            con.commit()
            return {"columns": [], "rows": [], "affected": cur.rowcount}
    finally:
        con.close()


def _sqlite_tables(database: str) -> list:
    res = _sqlite_query(database, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    return [r["name"] for r in res["rows"]]


def _sqlite_columns(database: str, table: str) -> list:
    res = _sqlite_query(database, f"PRAGMA table_info(`{table}`)")
    cols = []
    for r in res["rows"]:
        cols.append({
            "Field": r["name"],
            "Type": r["type"] or "TEXT",
            "Null": "YES" if not r["notnull"] else "NO",
            "Key": "PRI" if r["pk"] else "",
            "Default": r["dflt_value"],
            "Extra": "",
            "Collation": "",
            "Comment": "",
            "Privileges": "",
        })
    return cols


# ── MySQL CLI helper ──────────────────────────────────────────────────────────

def _mysql_args(cfg: dict, database: str = None) -> list:
    """Build mysql CLI argument list from connection config."""
    args = [
        "mysql",
        f"-h{cfg['host']}",
        f"-P{cfg['port']}",
        f"-u{cfg['user']}",
        f"-p{cfg['password']}",
        "--batch",
        "--skip-column-names",
        "--default-character-set=utf8mb4",
    ]
    if database:
        args.append(database)
    return args


def _run_mysql(cfg: dict, sql: str, database: str = None) -> str:
    """Run a SQL statement via mysql CLI and return raw output."""
    args = _mysql_args(cfg, database)
    r = subprocess.run(
        args,
        input=sql,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if r.returncode != 0:
        err = r.stderr.strip()
        # Strip the "mysql: [Warning] Using a password..." line
        lines = [l for l in err.splitlines() if "Using a password" not in l]
        raise HTTPException(400, "\n".join(lines) or err)
    return r.stdout


def _run_mysql_json(cfg: dict, sql: str, database: str = None) -> list:
    """Run SQL and return list of dicts (tab-separated output with header)."""
    args = _mysql_args(cfg, database)
    # Use --column-names to get header row
    args = [a for a in args if a != "--skip-column-names"]
    r = subprocess.run(
        args,
        input=sql,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if r.returncode != 0:
        err = r.stderr.strip()
        lines = [l for l in err.splitlines() if "Using a password" not in l]
        raise HTTPException(400, "\n".join(lines) or err)

    lines = r.stdout.splitlines()
    if not lines:
        return []
    columns = lines[0].split("\t")
    rows = []
    for line in lines[1:]:
        if not line:
            continue
        values = line.split("\t")
        row = {}
        for i, col in enumerate(columns):
            v = values[i] if i < len(values) else ""
            row[col] = None if v == "NULL" else v
        rows.append(row)
    return rows


def _run_mysql_write(cfg: dict, sql: str, database: str = None) -> int:
    """Run a write SQL statement and return affected rows."""
    args = _mysql_args(cfg, database)
    r = subprocess.run(
        args,
        input=sql,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if r.returncode != 0:
        err = r.stderr.strip()
        lines = [l for l in err.splitlines() if "Using a password" not in l]
        raise HTTPException(400, "\n".join(lines) or err)
    # mysql outputs "Query OK, N rows affected"
    for line in r.stderr.splitlines():
        if "rows affected" in line or "row affected" in line:
            try:
                return int(line.split()[2])
            except Exception:
                pass
    return 0


def _escape(val) -> str:
    """Escape a value for use in SQL string."""
    if val is None:
        return "NULL"
    s = str(val).replace("\\", "\\\\").replace("'", "\\'")
    return f"'{s}'"


def _is_sqlite_conn(conn_id: str) -> bool:
    return conn_id in (_MVMAPPS_CONN_ID, _CORE_CONN_ID)


def _where_mysql(where: dict) -> str:
    """Build a MySQL WHERE expression from a {col: value} dict (NULL-safe)."""
    if not where:
        raise HTTPException(400, "Empty WHERE")
    return " AND ".join(
        f"`{c}` IS NULL" if v is None else f"`{c}`={_escape(v)}" for c, v in where.items()
    )


def _where_sqlite(where: dict):
    """Build a parameterized SQLite WHERE expression. Returns (sql, params)."""
    if not where:
        raise HTTPException(400, "Empty WHERE")
    parts, params = [], []
    for c, v in where.items():
        if v is None:
            parts.append(f"`{c}` IS NULL")
        else:
            parts.append(f"`{c}`=?")
            params.append(v)
    return " AND ".join(parts), params


def _sqlite_write(path: str, sql: str, params: list) -> dict:
    con = sqlite3.connect(path)
    try:
        cur = con.execute(sql, params)
        con.commit()
        return {"affected": cur.rowcount, "last_id": cur.lastrowid}
    finally:
        con.close()


# ── Connections ───────────────────────────────────────────────────────────────

def _get_connections(user: str) -> list:
    with _app_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM connections WHERE user=? ORDER BY created_at", (user,)
        ).fetchall()
    return [dict(r) for r in rows]


def _get_conn_by_id(user: str, conn_id: str) -> dict:
    with _app_conn() as conn:
        row = conn.execute(
            "SELECT * FROM connections WHERE id=? AND user=?", (conn_id, user)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Connection not found")
    return dict(row)


def _get_conn_config(user: str, conn_id: str) -> dict:
    c = _get_conn_by_id(user, conn_id)
    c["user"] = c.get("db_user", c.get("user", ""))
    return c


@router.get("/connections")
def list_connections(session=Depends(get_current_session)):
    conns = _get_connections(session["effective_user"])
    safe = [{k: v for k, v in c.items() if k != "password"} for c in conns]
    # Append built-in system connections after user connections
    safe.append({
        "id": _MVMAPPS_CONN_ID,
        "name": "mvmApps",
        "host": "local",
        "port": 0,
        "db_user": "",
        "database": "",
        "builtin": True,
    })
    safe.append({
        "id": _CORE_CONN_ID,
        "name": "mvmOS Core",
        "host": "local",
        "port": 0,
        "db_user": "",
        "database": "",
        "builtin": True,
    })
    return JSONResponse(safe)


class ConnectionBody(BaseModel):
    id: Optional[str] = None
    name: str
    host: str = "localhost"
    port: int = 3306
    user: str
    password: str
    database: str = ""


@router.post("/connections")
def save_connection(body: ConnectionBody, session=Depends(get_current_session)):
    import uuid
    user = session["effective_user"]
    conn_id = body.id or str(uuid.uuid4())[:8]
    password = body.password
    if not password and body.id:
        try:
            existing = _get_conn_by_id(user, conn_id)
            password = existing["password"]
        except HTTPException:
            pass
    with _app_conn() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO connections (id, user, name, host, port, db_user, password, database)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (conn_id, user, body.name, body.host, body.port, body.user, password, body.database))
    return {"ok": True, "id": conn_id}


@router.delete("/connections/{conn_id}")
def delete_connection(conn_id: str, session=Depends(get_current_session)):
    user = session["effective_user"]
    with _app_conn() as conn:
        conn.execute("DELETE FROM connections WHERE id=? AND user=?", (conn_id, user))
    return {"ok": True}


class DbNameBody(BaseModel):
    conn_id: str
    name: str


@router.post("/create-database")
def create_database(body: DbNameBody, session=Depends(get_current_session)):
    import re as _re
    if not _re.match(r'^[a-zA-Z0-9_\-]+$', body.name.strip()):
        raise HTTPException(400, "Invalid database name")
    cfg = _get_conn_config(session["effective_user"], body.conn_id)
    _run_mysql_write(cfg, f"CREATE DATABASE `{body.name.strip()}`")
    return JSONResponse({"ok": True})


@router.post("/drop-database")
def drop_database(body: DbNameBody, session=Depends(get_current_session)):
    import re as _re
    if not _re.match(r'^[a-zA-Z0-9_\-]+$', body.name.strip()):
        raise HTTPException(400, "Invalid database name")
    cfg = _get_conn_config(session["effective_user"], body.conn_id)
    _run_mysql_write(cfg, f"DROP DATABASE `{body.name.strip()}`")
    return JSONResponse({"ok": True})


# ── MySQL queries ─────────────────────────────────────────────────────────────

@router.get("/databases")
def list_databases(conn_id: str, session=Depends(get_current_session)):
    if conn_id == _CORE_CONN_ID:
        return JSONResponse(["core"])
    if conn_id == _MVMAPPS_CONN_ID:
        dbs = set()
        for root in [_APPS_ROOT, _BACKEND_APPS_ROOT]:
            if os.path.isdir(root):
                for entry in os.listdir(root):
                    if os.path.exists(os.path.join(root, entry, "data.db")):
                        dbs.add(entry)
        return JSONResponse(sorted(dbs))
    cfg = _get_conn_config(session["effective_user"], conn_id)
    try:
        output = _run_mysql(cfg, "SHOW DATABASES;")
        dbs = [line for line in output.splitlines() if line]
        return JSONResponse(dbs)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


@router.get("/tables")
def list_tables(conn_id: str, database: str, session=Depends(get_current_session)):
    if conn_id == _CORE_CONN_ID:
        con = sqlite3.connect(_CORE_DB_PATH)
        tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()]
        con.close()
        return JSONResponse(tables)
    if conn_id == _MVMAPPS_CONN_ID:
        return JSONResponse(_sqlite_tables(database))
    cfg = _get_conn_config(session["effective_user"], conn_id)
    try:
        output = _run_mysql(cfg, f"SHOW TABLES;", database=database)
        tables = [line for line in output.splitlines() if line]
        return JSONResponse(tables)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


class QueryBody(BaseModel):
    conn_id: str
    database: str = ""
    sql: str
    limit: int = 500
    offset: int = 0


@router.post("/query")
def run_query(body: QueryBody, session=Depends(get_current_session)):
    if body.conn_id in (_MVMAPPS_CONN_ID, _CORE_CONN_ID):
        try:
            path = _resolve_sqlite_path(body.conn_id, body.database)
            res = _sqlite_query_path(path, body.sql.strip())
            return JSONResponse(res)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(400, str(e))
    cfg = _get_conn_config(session["effective_user"], body.conn_id)
    try:
        sql = body.sql.strip()
        is_select = sql.upper().startswith(("SELECT", "SHOW", "DESCRIBE", "EXPLAIN"))
        db = body.database or None
        if is_select:
            rows = _run_mysql_json(cfg, sql, database=db)
            columns = list(rows[0].keys()) if rows else []
            return JSONResponse({"columns": columns, "rows": rows, "affected": None})
        else:
            affected = _run_mysql_write(cfg, sql, database=db)
            return JSONResponse({"columns": [], "rows": [], "affected": affected})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


class UpdateRowBody(BaseModel):
    conn_id: str
    database: str
    table: str
    where: dict
    updates: dict


@router.post("/update-row")
def update_row(body: UpdateRowBody, session=Depends(get_current_session)):
    try:
        if _is_sqlite_conn(body.conn_id):
            path = _resolve_sqlite_path(body.conn_id, body.database)
            set_parts = [f"`{c}`=?" for c in body.updates]
            where_sql, where_params = _where_sqlite(body.where)
            res = _sqlite_write(path, f"UPDATE `{body.table}` SET {', '.join(set_parts)} WHERE {where_sql}",
                                list(body.updates.values()) + where_params)
            return {"ok": True, "affected": res["affected"]}
        cfg = _get_conn_config(session["effective_user"], body.conn_id)
        set_parts = [f"`{c}`={_escape(v)}" for c, v in body.updates.items()]
        sql = f"UPDATE `{body.table}` SET {', '.join(set_parts)} WHERE {_where_mysql(body.where)};"
        affected = _run_mysql_write(cfg, sql, database=body.database)
        return {"ok": True, "affected": affected}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


class InsertRowBody(BaseModel):
    conn_id: str
    database: str
    table: str
    values: dict


@router.post("/insert-row")
def insert_row(body: InsertRowBody, session=Depends(get_current_session)):
    try:
        cols = list(body.values.keys())
        col_str = ", ".join([f"`{c}`" for c in cols])
        if _is_sqlite_conn(body.conn_id):
            path = _resolve_sqlite_path(body.conn_id, body.database)
            qs = ", ".join("?" for _ in cols)
            res = _sqlite_write(path, f"INSERT INTO `{body.table}` ({col_str}) VALUES ({qs})",
                                list(body.values.values()))
            return {"ok": True, "id": res["last_id"]}
        cfg = _get_conn_config(session["effective_user"], body.conn_id)
        vals = [_escape(v) for v in body.values.values()]
        sql = f"INSERT INTO `{body.table}` ({col_str}) VALUES ({', '.join(vals)});"
        _run_mysql_write(cfg, sql, database=body.database)
        # Get last insert id
        rows = _run_mysql_json(cfg, "SELECT LAST_INSERT_ID() as id;", database=body.database)
        last_id = rows[0]["id"] if rows else None
        return {"ok": True, "id": last_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


class BulkDeleteBody(BaseModel):
    conn_id: str
    database: str
    table: str
    mode: str = "page"
    where_rows: Optional[list] = None


@router.post("/bulk-delete")
def bulk_delete(body: BulkDeleteBody, session=Depends(get_current_session)):
    try:
        deleted = 0
        if _is_sqlite_conn(body.conn_id):
            path = _resolve_sqlite_path(body.conn_id, body.database)
            if body.mode == "all":
                deleted = _sqlite_write(path, f"DELETE FROM `{body.table}`", [])["affected"]
            elif body.where_rows:
                for where_dict in body.where_rows:
                    where_sql, params = _where_sqlite(where_dict)
                    deleted += _sqlite_write(path, f"DELETE FROM `{body.table}` WHERE {where_sql}", params)["affected"]
            return {"ok": True, "affected": deleted}
        cfg = _get_conn_config(session["effective_user"], body.conn_id)
        if body.mode == "all":
            deleted = _run_mysql_write(cfg, f"DELETE FROM `{body.table}`;", database=body.database)
        elif body.where_rows:
            for where_dict in body.where_rows:
                sql = f"DELETE FROM `{body.table}` WHERE {_where_mysql(where_dict)};"
                deleted += _run_mysql_write(cfg, sql, database=body.database)
        return {"ok": True, "affected": deleted}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


class BulkUpdateBody(BaseModel):
    conn_id: str
    database: str
    table: str
    updates: dict
    mode: str = "page"
    where_rows: Optional[list] = None


@router.post("/bulk-update")
def bulk_update(body: BulkUpdateBody, session=Depends(get_current_session)):
    try:
        if _is_sqlite_conn(body.conn_id):
            path = _resolve_sqlite_path(body.conn_id, body.database)
            set_parts, set_params = [], []
            for col, op_dict in body.updates.items():
                operation = op_dict.get("op", "set") if isinstance(op_dict, dict) else "set"
                val = op_dict.get("value") if isinstance(op_dict, dict) else op_dict
                if operation == "set_null" or (operation == "set" and val is None):
                    set_parts.append(f"`{col}`=NULL")
                elif operation == "set":
                    set_parts.append(f"`{col}`=?")
                    set_params.append(val)
                elif operation == "increment":
                    set_parts.append(f"`{col}`=`{col}`+?")
                    set_params.append(val)
                elif operation == "decrement":
                    set_parts.append(f"`{col}`=`{col}`-?")
                    set_params.append(val)
            if not set_parts:
                raise HTTPException(400, "No operations")
            total_affected = 0
            if body.mode == "all":
                total_affected = _sqlite_write(path, f"UPDATE `{body.table}` SET {', '.join(set_parts)}", set_params)["affected"]
            elif body.where_rows:
                for where_dict in body.where_rows:
                    where_sql, wparams = _where_sqlite(where_dict)
                    total_affected += _sqlite_write(path, f"UPDATE `{body.table}` SET {', '.join(set_parts)} WHERE {where_sql}",
                                                    set_params + wparams)["affected"]
            return {"ok": True, "affected": total_affected}
        cfg = _get_conn_config(session["effective_user"], body.conn_id)
        set_parts = []
        for col, op_dict in body.updates.items():
            operation = op_dict.get("op", "set") if isinstance(op_dict, dict) else "set"
            val = op_dict.get("value") if isinstance(op_dict, dict) else op_dict
            if operation == "set_null" or (operation == "set" and val is None):
                set_parts.append(f"`{col}`=NULL")
            elif operation == "set":
                set_parts.append(f"`{col}`={_escape(val)}")
            elif operation == "increment":
                set_parts.append(f"`{col}`=`{col}`+{_escape(val)}")
            elif operation == "decrement":
                set_parts.append(f"`{col}`=`{col}`-{_escape(val)}")
        if not set_parts:
            raise HTTPException(400, "No operations")
        total_affected = 0
        if body.mode == "all":
            sql = f"UPDATE `{body.table}` SET {', '.join(set_parts)};"
            total_affected = _run_mysql_write(cfg, sql, database=body.database)
        elif body.where_rows:
            for where_dict in body.where_rows:
                sql = f"UPDATE `{body.table}` SET {', '.join(set_parts)} WHERE {_where_mysql(where_dict)};"
                total_affected += _run_mysql_write(cfg, sql, database=body.database)
        return {"ok": True, "affected": total_affected}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


def _build_where_cli(filters, search=None, search_cols=None):
    """Build WHERE clause from filter list for CLI queries."""
    parts = []
    if search and search_cols:
        parts.append("(" + " OR ".join([f"`{c}` LIKE '%{search}%'" for c in search_cols]) + ")")
    OP_MAP = {
        '=': '`{col}`={val}',
        '!=': '`{col}`!={val}',
        '<': '`{col}`<{val}',
        '>': '`{col}`>{val}',
        '<=': '`{col}`<={val}',
        '>=': '`{col}`>={val}',
        'LIKE': '`{col}` LIKE {val}',
        'NOT LIKE': '`{col}` NOT LIKE {val}',
        'LIKE %%': '`{col}` LIKE \'%{raw}%\'',
        'REGEXP': '`{col}` REGEXP {val}',
        'IS NULL': '`{col}` IS NULL',
        'IS NOT NULL': '`{col}` IS NOT NULL',
    }
    for f in (filters or []):
        col = f.get('col') if isinstance(f, dict) else f.col
        op = f.get('op') if isinstance(f, dict) else f.op
        val = f.get('val', '') if isinstance(f, dict) else getattr(f, 'val', '')
        if op not in OP_MAP:
            continue
        tpl = OP_MAP[op]
        if op == 'LIKE %%':
            parts.append(tpl.format(col=col, raw=val.replace("'", "\\'")))
        elif op in ('IS NULL', 'IS NOT NULL'):
            parts.append(tpl.format(col=col))
        else:
            parts.append(tpl.format(col=col, val=_escape(val)))
    return ("WHERE " + " AND ".join(parts)) if parts else ""


class TableDataBody(BaseModel):
    conn_id: str
    database: str
    table: str
    limit: int = 100
    offset: int = 0
    search: str = ""
    order_by: str = ""
    order_dir: str = "ASC"
    filters: Optional[list] = None
    sort: Optional[list] = None


@router.post("/table-data")
def get_table_data(body: TableDataBody, session=Depends(get_current_session)):
    if body.conn_id in (_MVMAPPS_CONN_ID, _CORE_CONN_ID):
        try:
            path = _resolve_sqlite_path(body.conn_id, body.database)
            where = _build_where_cli(body.filters)
            cnt_res = _sqlite_query_path(path, f"SELECT COUNT(*) as cnt FROM `{body.table}` {where}")
            total = int(cnt_res["rows"][0]["cnt"]) if cnt_res["rows"] else 0
            order_parts = []
            if body.sort:
                for s in body.sort:
                    col = s.get('col') if isinstance(s, dict) else s.col
                    dir_ = "DESC" if (s.get('dir') if isinstance(s, dict) else s.dir).upper() == "DESC" else "ASC"
                    order_parts.append(f"`{col}` {dir_}")
            order = ("ORDER BY " + ", ".join(order_parts)) if order_parts else ""
            res = _sqlite_query_path(path, f"SELECT * FROM `{body.table}` {where} {order} LIMIT {body.limit} OFFSET {body.offset}")
            return JSONResponse({"columns": res["columns"], "rows": res["rows"], "total": total})
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(400, str(e))
    cfg = _get_conn_config(session["effective_user"], body.conn_id)
    try:
        search_cols = []
        if body.search:
            cols_rows = _run_mysql_json(cfg, f"DESCRIBE `{body.table}`;", database=body.database)
            search_cols = [c["Field"] for c in cols_rows if any(t in c["Type"].lower() for t in ["char", "text", "varchar"])]

        where = _build_where_cli(body.filters, body.search, search_cols)

        count_rows = _run_mysql_json(cfg, f"SELECT COUNT(*) as cnt FROM `{body.table}` {where};", database=body.database)
        total = int(count_rows[0]["cnt"]) if count_rows else 0

        order_parts = []
        if body.sort:
            for s in body.sort:
                col = s.get('col') if isinstance(s, dict) else s.col
                dir_ = "DESC" if (s.get('dir') if isinstance(s, dict) else s.dir).upper() == "DESC" else "ASC"
                order_parts.append(f"`{col}` {dir_}")
        elif body.order_by:
            dir_ = "DESC" if body.order_dir.upper() == "DESC" else "ASC"
            order_parts.append(f"`{body.order_by}` {dir_}")
        order = ("ORDER BY " + ", ".join(order_parts)) if order_parts else ""

        rows = _run_mysql_json(cfg, f"SELECT * FROM `{body.table}` {where} {order} LIMIT {body.limit} OFFSET {body.offset};", database=body.database)
        columns = list(rows[0].keys()) if rows else []
        return JSONResponse({"columns": columns, "rows": rows, "total": total})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


class UpdateCellBody(BaseModel):
    conn_id: str
    database: str
    table: str
    where: dict
    column: str
    value: Optional[str] = None


@router.post("/update-cell")
def update_cell(body: UpdateCellBody, session=Depends(get_current_session)):
    try:
        if _is_sqlite_conn(body.conn_id):
            path = _resolve_sqlite_path(body.conn_id, body.database)
            where_sql, params = _where_sqlite(body.where)
            _sqlite_write(path, f"UPDATE `{body.table}` SET `{body.column}`=? WHERE {where_sql}",
                          [body.value] + params)
            return {"ok": True}
        cfg = _get_conn_config(session["effective_user"], body.conn_id)
        sql = f"UPDATE `{body.table}` SET `{body.column}`={_escape(body.value)} WHERE {_where_mysql(body.where)};"
        _run_mysql_write(cfg, sql, database=body.database)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


class DeleteRowBody(BaseModel):
    conn_id: str
    database: str
    table: str
    where: Optional[dict] = None
    primary_key: Optional[str] = None
    primary_value: Optional[str] = None


@router.post("/delete-row")
def delete_row(body: DeleteRowBody, session=Depends(get_current_session)):
    try:
        if _is_sqlite_conn(body.conn_id):
            path = _resolve_sqlite_path(body.conn_id, body.database)
            if body.where:
                where_sql, params = _where_sqlite(body.where)
            else:
                where_sql, params = f"`{body.primary_key}`=?", [body.primary_value]
            _sqlite_write(path, f"DELETE FROM `{body.table}` WHERE {where_sql}", params)
            return {"ok": True}
        cfg = _get_conn_config(session["effective_user"], body.conn_id)
        if body.where:
            sql = f"DELETE FROM `{body.table}` WHERE {_where_mysql(body.where)};"
        else:
            sql = f"DELETE FROM `{body.table}` WHERE `{body.primary_key}`={_escape(body.primary_value)};"
        _run_mysql_write(cfg, sql, database=body.database)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


@router.get("/table-structure")
def table_structure(conn_id: str, database: str, table: str, session=Depends(get_current_session)):
    if conn_id in (_MVMAPPS_CONN_ID, _CORE_CONN_ID):
        try:
            path = _resolve_sqlite_path(conn_id, database)
            con = sqlite3.connect(path)
            con.row_factory = sqlite3.Row
            rows = con.execute(f"PRAGMA table_info(`{table}`)").fetchall()
            con.close()
            columns = [{"Field": r["name"], "Type": r["type"] or "TEXT", "Null": "YES" if not r["notnull"] else "NO",
                        "Key": "PRI" if r["pk"] else "", "Default": r["dflt_value"], "Extra": "",
                        "Collation": "", "Comment": "", "Privileges": ""} for r in rows]
            return JSONResponse({"columns": columns, "indexes": [], "foreign_keys": []})
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(400, str(e))
    cfg = _get_conn_config(session["effective_user"], conn_id)
    try:
        columns = _run_mysql_json(cfg, f"SHOW FULL COLUMNS FROM `{table}`;", database=database)
        indexes = _run_mysql_json(cfg, f"SHOW INDEX FROM `{table}`;", database=database)
        fk_sql = """
            SELECT kcu.CONSTRAINT_NAME AS name, kcu.COLUMN_NAME AS col,
                   kcu.REFERENCED_TABLE_SCHEMA AS ref_db, kcu.REFERENCED_TABLE_NAME AS ref_table,
                   kcu.REFERENCED_COLUMN_NAME AS ref_col, rc.UPDATE_RULE AS on_update, rc.DELETE_RULE AS on_delete
            FROM information_schema.KEY_COLUMN_USAGE kcu
            JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
                ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
                AND rc.CONSTRAINT_SCHEMA = kcu.TABLE_SCHEMA
                AND rc.TABLE_NAME = kcu.TABLE_NAME
            WHERE kcu.TABLE_SCHEMA = '""" + database.replace("'", "") + """'
              AND kcu.TABLE_NAME = '""" + table.replace("'", "") + """'
              AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
            ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
        """
        fk_rows = _run_mysql_json(cfg, fk_sql)
        fks = {}
        for r in fk_rows:
            n = r["name"]
            if n not in fks:
                fks[n] = {"name": n, "columns": [], "ref_db": r["ref_db"],
                          "ref_table": r["ref_table"], "ref_cols": [],
                          "on_update": r["on_update"], "on_delete": r["on_delete"]}
            fks[n]["columns"].append(r["col"])
            fks[n]["ref_cols"].append(r["ref_col"])
        return JSONResponse({"columns": columns, "indexes": indexes, "foreign_keys": list(fks.values())})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


# ── Create Table ─────────────────────────────────────────────────────────────

class CreateTableBody(BaseModel):
    conn_id: str
    database: str
    table: str
    engine: str = "InnoDB"
    collation: str = ""
    comment: str = ""
    columns: list


@router.post("/create-table")
def create_table(body: CreateTableBody, session=Depends(get_current_session)):
    cfg = _get_conn_config(session["effective_user"], body.conn_id)
    db = body.database.strip()
    tbl = body.table.strip()
    if not _VALID_ID.match(db) or not _re.match(r'^[a-zA-Z0-9_]+$', tbl):
        raise HTTPException(400, "Invalid table name")
    try:
        col_defs = []
        primary_cols = []
        for col in body.columns:
            name = (col.get("name") or "").strip()
            if not name or not _re.match(r'^[a-zA-Z0-9_]+$', name):
                raise HTTPException(400, f"Invalid column name: {name}")
            base_type = (col.get("type") or "VARCHAR").strip().upper()
            type_str = _build_type_str(base_type, col)
            null_str = "NULL" if col.get("allowNull") else "NOT NULL"
            default_str = ""
            def_type = col.get("defaultType", "NULL")
            def_val = str(col.get("defaultValue", "") or "")
            allow_null = bool(col.get("allowNull"))
            auto_inc = bool(col.get("autoIncrement"))
            if not auto_inc and base_type not in _NO_DEFAULT_TYPES:
                if def_type == "NULL":
                    if allow_null:
                        default_str = "DEFAULT NULL"
                elif def_type == "EMPTY":
                    if base_type in _STRING_TYPES:
                        default_str = "DEFAULT ''"
                elif def_type == "CURRENT_TIMESTAMP":
                    default_str = "DEFAULT CURRENT_TIMESTAMP"
                elif def_type == "VALUE" and def_val:
                    default_str = f"DEFAULT '{def_val.replace(chr(39), chr(39)+chr(39))}'"
            ai_str = "AUTO_INCREMENT" if auto_inc else ""
            collation = (col.get("collation") or "").strip()
            charset_str = ""
            if collation and _re.match(r'^[a-zA-Z0-9_]+$', collation):
                charset = collation.split("_")[0]
                charset_str = f"CHARACTER SET {charset} COLLATE {collation}"
            col_def = f"`{name}` {type_str} {charset_str} {null_str} {default_str} {ai_str}".strip()
            col_defs.append(col_def)
            if col.get("primary"):
                primary_cols.append(f"`{name}`")
        if primary_cols:
            col_defs.append(f"PRIMARY KEY ({', '.join(primary_cols)})")
        engine_str = f"ENGINE={body.engine}" if body.engine else "ENGINE=InnoDB"
        collation_str = f"COLLATE={body.collation}" if body.collation else ""
        comment_str = f"COMMENT='{body.comment.replace(chr(39), chr(39)+chr(39))}'" if body.comment else ""
        options = " ".join(filter(None, [engine_str, collation_str, comment_str]))
        sql = f"CREATE TABLE `{tbl}` (\n  " + ",\n  ".join(col_defs) + f"\n) {options};"
        _run_mysql_write(cfg, sql, database=db)
        return JSONResponse({"ok": True, "sql": sql})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


# ── Alter Table ───────────────────────────────────────────────────────────────

import re as _re

_VALID_ID = _re.compile(r'^[a-zA-Z0-9_\-\.]+$')
_NO_DEFAULT_TYPES = {'TEXT','TINYTEXT','MEDIUMTEXT','LONGTEXT','BLOB','TINYBLOB','MEDIUMBLOB','LONGBLOB','JSON','GEOMETRY'}
_STRING_TYPES = {'CHAR','VARCHAR','TINYTEXT','TEXT','MEDIUMTEXT','LONGTEXT','BINARY','VARBINARY','ENUM','SET'}
_NEEDS_LENGTH = {'TINYINT','SMALLINT','MEDIUMINT','INT','BIGINT','FLOAT','DOUBLE','DECIMAL','NUMERIC','CHAR','VARCHAR','BINARY','VARBINARY','BIT'}
_NEEDS_DECIMALS = {'FLOAT','DOUBLE','DECIMAL','NUMERIC'}
_NEEDS_ENUM = {'ENUM','SET'}
_CAN_UNSIGNED = {'TINYINT','SMALLINT','MEDIUMINT','INT','BIGINT','FLOAT','DOUBLE','DECIMAL','NUMERIC'}


def _build_type_str(base: str, col: dict) -> str:
    length = str(col.get("length", "") or "").strip()
    decimals = str(col.get("decimals", "") or "").strip()
    enum_vals = str(col.get("enumValues", "") or "").strip()
    unsigned = bool(col.get("unsigned"))
    if base in _NEEDS_ENUM and enum_vals:
        return f"{base}({enum_vals})"
    if base in _NEEDS_DECIMALS and length and decimals:
        return f"{base}({length},{decimals})" + (" UNSIGNED" if unsigned and base in _CAN_UNSIGNED else "")
    if base in _NEEDS_LENGTH and length:
        return f"{base}({length})" + (" UNSIGNED" if unsigned and base in _CAN_UNSIGNED else "")
    return base + (" UNSIGNED" if unsigned and base in _CAN_UNSIGNED else "")


class AlterTableBody(BaseModel):
    conn_id: str
    database: str
    table: str
    columns: list


@router.post("/alter-table")
def alter_table(body: AlterTableBody, session=Depends(get_current_session)):
    cfg = _get_conn_config(session["effective_user"], body.conn_id)
    db = body.database.strip()
    tbl = body.table.strip()
    if not _VALID_ID.match(db) or not _VALID_ID.match(tbl):
        raise HTTPException(400, "Invalid identifier")
    try:
        existing = _run_mysql_json(cfg, f"SHOW COLUMNS FROM `{tbl}`;", database=db)
        existing_names = [r["Field"] for r in existing]
        clauses = []
        prev = None
        for col in body.columns:
            orig_name = (col.get("originalName") or "").strip()
            new_name = (col.get("name") or "").strip()
            base_type = (col.get("baseType") or "VARCHAR").strip().upper()
            if not new_name:
                continue
            if not _re.match(r'^[a-zA-Z0-9_]+$', new_name):
                raise HTTPException(400, f"Invalid column name: {new_name}")
            type_str = _build_type_str(base_type, col)
            null_str = "NULL" if col.get("allowNull") else "NOT NULL"
            default_str = ""
            def_type = col.get("defaultType", "NULL")
            def_val = str(col.get("defaultValue", "") or "")
            allow_null = bool(col.get("allowNull"))
            auto_inc = bool(col.get("autoIncrement"))
            if not auto_inc and base_type not in _NO_DEFAULT_TYPES:
                if def_type == "NULL":
                    if allow_null:
                        default_str = "DEFAULT NULL"
                elif def_type == "EMPTY":
                    if base_type in _STRING_TYPES:
                        default_str = "DEFAULT ''"
                elif def_type == "CURRENT_TIMESTAMP":
                    default_str = "DEFAULT CURRENT_TIMESTAMP"
                elif def_type == "VALUE" and def_val:
                    escaped = def_val.replace("'", "\\'")
                    default_str = f"DEFAULT '{escaped}'"
            ai_str = "AUTO_INCREMENT" if auto_inc else ""
            collation = (col.get("collation") or "").strip()
            charset_str = ""
            if collation and _re.match(r'^[a-zA-Z0-9_]+$', collation):
                charset = collation.split("_")[0]
                charset_str = f"CHARACTER SET {charset} COLLATE {collation}"
            pos_str = "FIRST" if prev is None else f"AFTER `{prev}`"
            col_def = f"`{new_name}` {type_str} {charset_str} {null_str} {default_str} {ai_str}".strip()
            if orig_name and orig_name in existing_names:
                clauses.append(f"CHANGE `{orig_name}` {col_def} {pos_str}")
            else:
                clauses.append(f"ADD COLUMN {col_def} {pos_str}")
            prev = new_name
        new_originals = [c.get("originalName", "") for c in body.columns if c.get("originalName")]
        for ex in existing_names:
            if ex not in new_originals:
                clauses.append(f"DROP COLUMN `{ex}`")
        if not clauses:
            return JSONResponse({"success": True, "message": "No changes"})
        sql = f"ALTER TABLE `{tbl}` " + ", ".join(clauses)
        _run_mysql_write(cfg, sql, database=db)
        return JSONResponse({"success": True, "sql": sql})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


# ── Indexes ───────────────────────────────────────────────────────────────────

class IndexBody(BaseModel):
    conn_id: str
    database: str
    table: str
    action: str
    name: Optional[str] = None
    type: Optional[str] = None
    columns: Optional[list] = None


@router.post("/indexes")
def manage_indexes(body: IndexBody, session=Depends(get_current_session)):
    cfg = _get_conn_config(session["effective_user"], body.conn_id)
    db = body.database.strip()
    tbl = body.table.strip()
    if not _VALID_ID.match(db) or not _VALID_ID.match(tbl):
        raise HTTPException(400, "Invalid identifier")
    try:
        if body.action == "add":
            cols = body.columns or []
            if not cols:
                raise HTTPException(400, "At least one column is required")
            idx_type = (body.type or "INDEX").strip().upper()
            col_list = ", ".join([f"`{_re.sub(r'[^a-zA-Z0-9_]', '', c)}`" for c in cols])
            name = (body.name or "").strip()
            if idx_type == "PRIMARY":
                sql = f"ALTER TABLE `{tbl}` ADD PRIMARY KEY ({col_list})"
            elif idx_type == "UNIQUE":
                iname = name or "_".join(cols) + "_unique"
                sql = f"ALTER TABLE `{tbl}` ADD UNIQUE INDEX `{iname}` ({col_list})"
            elif idx_type == "FULLTEXT":
                iname = name or "_".join(cols) + "_fulltext"
                sql = f"ALTER TABLE `{tbl}` ADD FULLTEXT INDEX `{iname}` ({col_list})"
            else:
                iname = name or "_".join(cols) + "_idx"
                sql = f"ALTER TABLE `{tbl}` ADD INDEX `{iname}` ({col_list})"
            _run_mysql_write(cfg, sql, database=db)
            return JSONResponse({"success": True, "sql": sql})
        elif body.action == "drop":
            name = (body.name or "").strip()
            if not name:
                raise HTTPException(400, "Index name is required")
            if name == "PRIMARY":
                sql = f"ALTER TABLE `{tbl}` DROP PRIMARY KEY"
            else:
                sql = f"ALTER TABLE `{tbl}` DROP INDEX `{name}`"
            _run_mysql_write(cfg, sql, database=db)
            return JSONResponse({"success": True, "sql": sql})
        else:
            raise HTTPException(400, "Unknown action")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


# ── Foreign Keys ──────────────────────────────────────────────────────────────

class FKBody(BaseModel):
    conn_id: str
    database: str
    table: str
    action: str
    name: Optional[str] = None
    columns: Optional[list] = None
    ref_db: Optional[str] = None
    ref_table: Optional[str] = None
    ref_cols: Optional[list] = None
    on_update: Optional[str] = "RESTRICT"
    on_delete: Optional[str] = "RESTRICT"


@router.post("/foreign-keys")
def manage_foreign_keys(body: FKBody, session=Depends(get_current_session)):
    cfg = _get_conn_config(session["effective_user"], body.conn_id)
    db = body.database.strip()
    tbl = body.table.strip()
    if not _VALID_ID.match(db) or not _VALID_ID.match(tbl):
        raise HTTPException(400, "Invalid identifier")
    try:
        if body.action == "add":
            cols = body.columns or []
            ref_db = (body.ref_db or db).strip()
            ref_table = (body.ref_table or "").strip()
            ref_cols = body.ref_cols or []
            on_update = (body.on_update or "RESTRICT").strip().upper()
            on_delete = (body.on_delete or "RESTRICT").strip().upper()
            if not cols or not ref_table or not ref_cols:
                raise HTTPException(400, "columns, ref_table and ref_cols are required")
            allowed = {"RESTRICT", "CASCADE", "SET NULL", "NO ACTION", "SET DEFAULT"}
            if on_update not in allowed:
                on_update = "RESTRICT"
            if on_delete not in allowed:
                on_delete = "RESTRICT"
            for ident in [ref_table, ref_db] + cols + ref_cols:
                if not _VALID_ID.match(ident):
                    raise HTTPException(400, f"Invalid identifier: {ident}")
            engine_sql = f"SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA='{db}' AND TABLE_NAME='{tbl}'"
            eng_rows = _run_mysql_json(cfg, engine_sql)
            if eng_rows:
                engine = (eng_rows[0].get("ENGINE") or "").upper()
                if engine and engine != "INNODB":
                    raise HTTPException(400, f"Foreign keys require InnoDB. This table uses {engine}.")
            name = (body.name or "").strip()
            constraint = name or f"fk_{tbl}_{'_'.join(cols)}"
            col_list = ", ".join([f"`{c}`" for c in cols])
            ref_col_list = ", ".join([f"`{c}`" for c in ref_cols])
            sql = (f"ALTER TABLE `{tbl}` ADD CONSTRAINT `{constraint}` "
                   f"FOREIGN KEY ({col_list}) REFERENCES `{ref_db}`.`{ref_table}` ({ref_col_list}) "
                   f"ON UPDATE {on_update} ON DELETE {on_delete}")
            _run_mysql_write(cfg, sql, database=db)
            return JSONResponse({"success": True, "sql": sql})
        elif body.action == "drop":
            name = (body.name or "").strip()
            if not name or not _re.match(r'^[a-zA-Z0-9_\-]+$', name):
                raise HTTPException(400, "Invalid constraint name")
            sql = f"ALTER TABLE `{tbl}` DROP FOREIGN KEY `{name}`"
            _run_mysql_write(cfg, sql, database=db)
            return JSONResponse({"success": True, "sql": sql})
        else:
            raise HTTPException(400, "Unknown action")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


# ── Manage Tables ────────────────────────────────────────────────────────────

class ManageTablesBody(BaseModel):
    conn_id: str
    database: str
    operation: str
    tables: list


@router.post("/manage-tables")
def manage_tables(body: ManageTablesBody, session=Depends(get_current_session)):
    cfg = _get_conn_config(session["effective_user"], body.conn_id)
    db = body.database.strip()
    op = body.operation.strip().upper()
    ALLOWED = {"TRUNCATE", "DROP", "ANALYZE", "OPTIMIZE", "CHECK", "REPAIR"}
    if op not in ALLOWED:
        raise HTTPException(400, "Invalid operation")
    try:
        # Validate all table names first
        clean = []
        for tbl in body.tables:
            tbl = tbl.strip()
            if not _re.match(r'^[a-zA-Z0-9_]+$', tbl):
                raise HTTPException(400, f"Invalid table name: {tbl}")
            clean.append(tbl)

        if op == "DROP":
            # Disable FK checks for the whole batch, re-enable after
            drops = " ".join(f"DROP TABLE `{tbl}`;" for tbl in clean)
            _run_mysql_write(cfg,
                f"SET FOREIGN_KEY_CHECKS=0; {drops} SET FOREIGN_KEY_CHECKS=1;",
                database=db)
        else:
            for tbl in clean:
                if op == "TRUNCATE":
                    sql = f"TRUNCATE TABLE `{tbl}`;"
                else:
                    sql = f"{op} TABLE `{tbl}`;"
                _run_mysql_write(cfg, sql, database=db)

        return JSONResponse({"ok": True, "tables": clean})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


# ── Export ────────────────────────────────────────────────────────────────────

@router.get("/export")
def export_table(conn_id: str, database: str, table: str, format: str = "sql",
                 session=Depends(get_current_session)):
    cfg = _get_conn_config(session["effective_user"], conn_id)
    try:
        rows = _run_mysql_json(cfg, f"SELECT * FROM `{table}`;", database=database)
        columns = list(rows[0].keys()) if rows else []
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))

    if format == "csv":
        import csv, io
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(columns)
        for row in rows:
            writer.writerow([row.get(c, "") for c in columns])
        content = out.getvalue().encode()
        return StreamingResponse(iter([content]),
                                 media_type="text/csv",
                                 headers={"Content-Disposition": f"attachment; filename={table}.csv"})
    else:
        lines = [f"-- YourSQL export: {database}.{table}\n"]
        lines.append(f"-- Generated by YourSQL / mvmOS\n\n")
        col_list = ", ".join([f"`{c}`" for c in columns])
        for row in rows:
            vals = [_escape(row.get(c)) for c in columns]
            lines.append(f"INSERT INTO `{table}` ({col_list}) VALUES ({', '.join(vals)});\n")
        content = "".join(lines).encode()
        return StreamingResponse(iter([content]),
                                 media_type="application/sql",
                                 headers={"Content-Disposition": f"attachment; filename={table}.sql"})


# ── Export Multi ─────────────────────────────────────────────────────────────

@router.get("/export-multi")
def export_multi(conn_id: str, database: str, tables: str, format: str = "sql",
                 mode: str = "structure_data", zip: str = "0",
                 session=Depends(get_current_session)):
    cfg = _get_conn_config(session["effective_user"], conn_id)
    table_list = [t.strip() for t in tables.split(",") if t.strip()]
    do_zip = zip == "1"
    do_structure = mode in ("structure_data", "structure")
    do_data = mode in ("structure_data", "data")

    try:
        if format == "csv":
            import csv as _csv, io as _io, zipfile as _zf
            if do_zip:
                buf = _io.BytesIO()
                with _zf.ZipFile(buf, "w", _zf.ZIP_DEFLATED) as zf:
                    for tbl in table_list:
                        rows = _run_mysql_json(cfg, f"SELECT * FROM `{tbl}`;", database=database)
                        cols = list(rows[0].keys()) if rows else []
                        out = _io.StringIO()
                        w = _csv.writer(out)
                        w.writerow(cols)
                        for row in rows:
                            w.writerow([row.get(c, "") for c in cols])
                        zf.writestr(tbl + ".csv", out.getvalue())
                        # CSV stays as separate files per table in zip (makes sense for CSV)
                buf.seek(0)
                return StreamingResponse(buf, media_type="application/zip",
                    headers={"Content-Disposition": f"attachment; filename={database}.zip"})
            else:
                # single csv only for first table
                tbl = table_list[0]
                rows = _run_mysql_json(cfg, f"SELECT * FROM `{tbl}`;", database=database)
                cols = list(rows[0].keys()) if rows else []
                out = _io.StringIO()
                w = _csv.writer(out)
                w.writerow(cols)
                for row in rows:
                    w.writerow([row.get(c, "") for c in cols])
                return StreamingResponse(iter([out.getvalue().encode()]), media_type="text/csv",
                    headers={"Content-Disposition": f"attachment; filename={database}.csv"})
        else:
            import io as _io, zipfile as _zf
            def _table_sql(tbl):
                lines = [f"-- Table: {tbl}\n"]
                if do_structure:
                    create_rows = _run_mysql_json(cfg, f"SHOW CREATE TABLE `{tbl}`;", database=database)
                    if create_rows:
                        ddl = create_rows[0].get("Create Table","")
                        lines.append(ddl + ";\n\n")
                if do_data:
                    rows = _run_mysql_json(cfg, f"SELECT * FROM `{tbl}`;", database=database)
                    if rows:
                        cols = list(rows[0].keys())
                        col_list = ", ".join([f"`{c}`" for c in cols])
                        for row in rows:
                            vals = [_escape(row.get(c)) for c in cols]
                            lines.append(f"INSERT INTO `{tbl}` ({col_list}) VALUES ({', '.join(vals)});\n")
                        lines.append("\n")
                return "".join(lines)

            header = f"-- YourSQL export: {database}\n-- Generated by YourSQL / mvmOS\n\n"
            if do_zip:
                buf = _io.BytesIO()
                combined = header + "\n".join([_table_sql(t) for t in table_list])
                with _zf.ZipFile(buf, "w", _zf.ZIP_DEFLATED) as zf:
                    zf.writestr(database + ".sql", combined)
                buf.seek(0)
                return StreamingResponse(buf, media_type="application/zip",
                    headers={"Content-Disposition": f"attachment; filename={database}.zip"})
            else:
                header = f"-- YourSQL export: {database}\n-- Generated by YourSQL / mvmOS\n\n"
                content = header + "\n".join([_table_sql(t) for t in table_list])
                return StreamingResponse(iter([content.encode()]), media_type="application/sql",
                    headers={"Content-Disposition": f"attachment; filename={database}.sql"})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


# ── Import ────────────────────────────────────────────────────────────────────

from fastapi import UploadFile, File, Form


@router.post("/import")
async def import_file(
    conn_id: str = Form(...),
    database: str = Form(...),
    file: UploadFile = File(...),
    session=Depends(get_current_session)
):
    import tempfile
    cfg = _get_conn_config(session["effective_user"], conn_id)
    filename = file.filename or ""
    errors = []
    affected = 0

    tmp_path = None
    try:
        # Stream upload to temp file — no size limit, no memory load
        stmt_count = 0
        with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(filename)[1]) as tmp:
            tmp_path = tmp.name
            while True:
                chunk = await file.read(65536)
                if not chunk:
                    break
                tmp.write(chunk)
                stmt_count += chunk.count(b";")

        if filename.endswith(".csv"):
            import csv, io
            with open(tmp_path, "rb") as f:
                text = f.read().decode("utf-8-sig")
            reader = csv.DictReader(io.StringIO(text))
            rows = list(reader)
            if rows:
                table = filename.rsplit(".", 1)[0]
                cols = list(rows[0].keys())
                col_str = ", ".join([f"`{c}`" for c in cols])
                for row in rows:
                    vals = [_escape(row.get(c)) for c in cols]
                    sql = f"INSERT INTO `{table}` ({col_str}) VALUES ({', '.join(vals)});"
                    try:
                        _run_mysql_write(cfg, sql, database=database)
                        affected += 1
                    except Exception as e:
                        errors.append(str(e))
        else:
            # Feed file directly to mysql — one process, no memory load, no per-statement blocking
            args = _mysql_args(cfg, database)
            with open(tmp_path, "r", errors="replace") as f:
                r = subprocess.run(args, stdin=f, capture_output=True, text=True, timeout=3600)
            if r.returncode != 0:
                err = r.stderr.strip()
                lines = [l for l in err.splitlines() if "Using a password" not in l]
                errors = ["\n".join(lines) or err]
            else:
                affected = stmt_count

        return JSONResponse({"ok": True, "affected": affected, "errors": errors[:10]})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


import threading as _threading
import uuid as _uuid

_import_jobs: dict = {}  # job_id -> {status, result}


class ImportFromPathBody(BaseModel):
    conn_id: str
    database: str
    tmp_path: str
    filename: str = ""


@router.post("/import-from-path")
async def import_from_path(body: ImportFromPathBody, session=Depends(get_current_session)):
    """Start import in background, return job_id immediately to avoid Cloudflare 524."""
    allowed = os.path.realpath("/tmp/mvmos-uploads")
    real = os.path.realpath(body.tmp_path)
    if not real.startswith(allowed + "/"):
        raise HTTPException(403, "Invalid path")
    if not os.path.isfile(real):
        raise HTTPException(404, "File not found")

    cfg = _get_conn_config(session["effective_user"], body.conn_id)
    filename = body.filename or os.path.basename(real)
    job_id = _uuid.uuid4().hex[:10]
    _import_jobs[job_id] = {"status": "running"}

    def _run():
        errors = []
        affected = 0
        try:
            if filename.endswith(".csv"):
                import csv, io
                with open(real, "rb") as f:
                    text = f.read().decode("utf-8-sig")
                reader = csv.DictReader(io.StringIO(text))
                rows = list(reader)
                if rows:
                    table = filename.rsplit(".", 1)[0]
                    cols = list(rows[0].keys())
                    col_str = ", ".join([f"`{c}`" for c in cols])
                    for row in rows:
                        vals = [_escape(row.get(c)) for c in cols]
                        sql = f"INSERT INTO `{table}` ({col_str}) VALUES ({', '.join(vals)});"
                        try:
                            _run_mysql_write(cfg, sql, database=body.database)
                            affected += 1
                        except Exception as e:
                            errors.append(str(e))
            else:
                args = _mysql_args(cfg, body.database)
                with open(real, "r", errors="replace") as f:
                    r = subprocess.run(args, stdin=f, capture_output=True, text=True, timeout=7200)
                if r.returncode != 0:
                    err = r.stderr.strip()
                    lines = [l for l in err.splitlines() if "Using a password" not in l]
                    errors = ["\n".join(lines) or err]
                else:
                    with open(real, "rb") as f:
                        affected = f.read().count(b";")
            _import_jobs[job_id] = {"status": "done", "ok": True, "affected": affected, "errors": errors[:10]}
        except Exception as e:
            _import_jobs[job_id] = {"status": "error", "detail": str(e)}
        finally:
            try:
                os.unlink(real)
            except Exception:
                pass

    _threading.Thread(target=_run, daemon=True).start()
    return JSONResponse({"ok": True, "job_id": job_id})


@router.get("/import-status/{job_id}")
async def import_status(job_id: str, session=Depends(get_current_session)):
    job = _import_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job["status"] != "running":
        _import_jobs.pop(job_id, None)
    return JSONResponse(job)

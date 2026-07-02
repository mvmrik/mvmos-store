"""
YourSQL — multi-database manager backend for mvmOS.
Routes: /api/apps/yoursql/...
Each connection has a db_type (mysql, mariadb, postgresql, cockroachdb,
gcloud_postgres, greenplum). backend.py dispatches to the matching dialect
module (dialect_mysql.py / dialect_postgres.py) based on the connection's
dialect family — see dialect_common.py. mvmApps/mvmOS Core builtin SQLite
connections are handled directly here, unchanged.
"""

import json
import os
import re
import subprocess
import sqlite3
import sys
import importlib.util

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from typing import Optional

get_current_session = sys.modules["backend.auth"].get_current_session

router = APIRouter(prefix="/api/apps/yoursql")
router._app_backend = "yoursql"

_APP_DIR = os.path.dirname(os.path.realpath(__file__))


def _load_sibling(name: str):
    """backend/app_backends.py loads this file via exec(), not real import
    machinery, so sibling modules can't use plain `import` — load by path."""
    spec = importlib.util.spec_from_file_location(f"yoursql_{name}", os.path.join(_APP_DIR, f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


dialect_common = _load_sibling("dialect_common")
dialect_mysql = _load_sibling("dialect_mysql")
dialect_postgres = _load_sibling("dialect_postgres")

_DIALECTS = {"mysql": dialect_mysql, "postgres": dialect_postgres}


def _dialect_for(db_type: str):
    return _DIALECTS[dialect_common.family_of(db_type)]


def _call(dialect, cfg, fn_name, *args, **kwargs):
    """Call a dialect function, turning driver_missing / ValueError into clean HTTPExceptions."""
    try:
        return getattr(dialect, fn_name)(cfg, *args, **kwargs)
    except HTTPException:
        raise
    except RuntimeError as e:
        if str(e) == "driver_missing":
            family = dialect_common.family_of(cfg.get("db_type"))
            _, package = dialect_common.DRIVERS[family]
            raise HTTPException(409, {"error": "driver_missing", "family": family, "package": package})
        raise HTTPException(400, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(400, str(e))


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
            db_type TEXT NOT NULL DEFAULT 'mysql',
            host TEXT NOT NULL DEFAULT 'localhost',
            port INTEGER NOT NULL DEFAULT 3306,
            db_user TEXT NOT NULL,
            password TEXT NOT NULL DEFAULT '',
            database TEXT NOT NULL DEFAULT '',
            created_at INTEGER DEFAULT (strftime('%s','now'))
        )
    """)
    try:
        conn.execute("ALTER TABLE connections ADD COLUMN db_type TEXT NOT NULL DEFAULT 'mysql'")
        conn.commit()
    except sqlite3.OperationalError:
        pass
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
    return _sqlite_query_path(path, sql)


def _sqlite_tables(database: str) -> list:
    res = _sqlite_query(database, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    return [r["name"] for r in res["rows"]]


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


def _is_sqlite_conn(conn_id: str) -> bool:
    return conn_id in (_MVMAPPS_CONN_ID, _CORE_CONN_ID)


def _build_where_cli(filters, search=None, search_cols=None):
    """Build a SQLite WHERE clause from the filter list (used only for the builtin SQLite connections)."""
    def _escape(val) -> str:
        if val is None:
            return "NULL"
        s = str(val).replace("\\", "\\\\").replace("'", "\\'")
        return f"'{s}'"

    parts = []
    if search and search_cols:
        parts.append("(" + " OR ".join([f"`{c}` LIKE '%{search}%'" for c in search_cols]) + ")")
    OP_MAP = {
        '=': '`{col}`={val}', '!=': '`{col}`!={val}', '<': '`{col}`<{val}', '>': '`{col}`>{val}',
        '<=': '`{col}`<={val}', '>=': '`{col}`>={val}', 'LIKE': '`{col}` LIKE {val}',
        'NOT LIKE': '`{col}` NOT LIKE {val}', 'LIKE %%': '`{col}` LIKE \'%{raw}%\'',
        'REGEXP': '`{col}` REGEXP {val}', 'IS NULL': '`{col}` IS NULL', 'IS NOT NULL': '`{col}` IS NOT NULL',
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


@router.get("/db-types")
def db_types(session=Depends(get_current_session)):
    return JSONResponse([
        {"id": k, "label": v, "family": dialect_common.family_of(k), "default_port": dialect_common.default_port(k)}
        for k, v in dialect_common.DB_TYPE_LABELS.items()
    ])


@router.get("/driver-status")
def driver_status(db_type: str, session=Depends(get_current_session)):
    family = dialect_common.family_of(db_type)
    dialect = _DIALECTS[family]
    _, package = dialect_common.DRIVERS[family]
    return JSONResponse({"available": dialect.driver_available(), "package": package, "family": family})


class InstallDriverBody(BaseModel):
    db_type: str


@router.post("/install-driver")
def install_driver(body: InstallDriverBody, session=Depends(get_current_session)):
    family = dialect_common.family_of(body.db_type)
    _, package = dialect_common.DRIVERS[family]
    try:
        r = subprocess.run(
            [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", package],
            capture_output=True, text=True, timeout=120,
        )
    except Exception as e:
        raise HTTPException(400, str(e))
    if r.returncode != 0:
        raise HTTPException(400, (r.stderr or r.stdout or "pip install failed").strip()[-2000:])
    # Reload the dialect module now that the package is importable in this process.
    global dialect_mysql, dialect_postgres
    if family == "mysql":
        dialect_mysql = _load_sibling("dialect_mysql")
        _DIALECTS["mysql"] = dialect_mysql
    else:
        dialect_postgres = _load_sibling("dialect_postgres")
        _DIALECTS["postgres"] = dialect_postgres
    return JSONResponse({"ok": True})


@router.get("/connections")
def list_connections(session=Depends(get_current_session)):
    conns = _get_connections(session["effective_user"])
    safe = [{k: v for k, v in c.items() if k != "password"} for c in conns]
    # Append built-in system connections after user connections
    safe.append({
        "id": _MVMAPPS_CONN_ID, "name": "mvmApps", "db_type": "sqlite",
        "host": "local", "port": 0, "db_user": "", "database": "", "builtin": True,
    })
    safe.append({
        "id": _CORE_CONN_ID, "name": "mvmOS Core", "db_type": "sqlite",
        "host": "local", "port": 0, "db_user": "", "database": "", "builtin": True,
    })
    return JSONResponse(safe)


class ConnectionBody(BaseModel):
    id: Optional[str] = None
    name: str
    db_type: str = "mysql"
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
            INSERT OR REPLACE INTO connections (id, user, name, db_type, host, port, db_user, password, database)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (conn_id, user, body.name, body.db_type, body.host, body.port, body.user, password, body.database))
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
    if not re.match(r'^[a-zA-Z0-9_\-]+$', body.name.strip()):
        raise HTTPException(400, "Invalid database name")
    cfg = _get_conn_config(session["effective_user"], body.conn_id)
    dialect = _dialect_for(cfg["db_type"])
    _call(dialect, cfg, "create_database", body.name.strip())
    return JSONResponse({"ok": True})


@router.post("/drop-database")
def drop_database(body: DbNameBody, session=Depends(get_current_session)):
    if not re.match(r'^[a-zA-Z0-9_\-]+$', body.name.strip()):
        raise HTTPException(400, "Invalid database name")
    cfg = _get_conn_config(session["effective_user"], body.conn_id)
    dialect = _dialect_for(cfg["db_type"])
    _call(dialect, cfg, "drop_database", body.name.strip())
    return JSONResponse({"ok": True})


# ── Databases / tables ────────────────────────────────────────────────────────

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
    dialect = _dialect_for(cfg["db_type"])
    dbs = _call(dialect, cfg, "list_databases")
    return JSONResponse(dbs)


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
    dialect = _dialect_for(cfg["db_type"])
    tables = _call(dialect, cfg, "list_tables", database)
    return JSONResponse(tables)


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
    dialect = _dialect_for(cfg["db_type"])
    res = _call(dialect, cfg, "run_query", body.database, body.sql.strip())
    if res.get("rows"):
        res["rows"] = dialect_common.json_safe_rows(res["rows"])
    return JSONResponse(res)


class UpdateRowBody(BaseModel):
    conn_id: str
    database: str
    table: str
    where: dict
    updates: dict


@router.post("/update-row")
def update_row(body: UpdateRowBody, session=Depends(get_current_session)):
    if _is_sqlite_conn(body.conn_id):
        path = _resolve_sqlite_path(body.conn_id, body.database)
        set_parts = [f"`{c}`=?" for c in body.updates]
        where_sql, where_params = _where_sqlite(body.where)
        res = _sqlite_write(path, f"UPDATE `{body.table}` SET {', '.join(set_parts)} WHERE {where_sql}",
                            list(body.updates.values()) + where_params)
        return {"ok": True, "affected": res["affected"]}
    cfg = _get_conn_config(session["effective_user"], body.conn_id)
    dialect = _dialect_for(cfg["db_type"])
    affected = _call(dialect, cfg, "update_row", body.database, body.table, body.where, body.updates)
    return {"ok": True, "affected": affected}


class InsertRowBody(BaseModel):
    conn_id: str
    database: str
    table: str
    values: dict


@router.post("/insert-row")
def insert_row(body: InsertRowBody, session=Depends(get_current_session)):
    if _is_sqlite_conn(body.conn_id):
        path = _resolve_sqlite_path(body.conn_id, body.database)
        cols = list(body.values.keys())
        col_str = ", ".join([f"`{c}`" for c in cols])
        qs = ", ".join("?" for _ in cols)
        res = _sqlite_write(path, f"INSERT INTO `{body.table}` ({col_str}) VALUES ({qs})",
                            list(body.values.values()))
        return {"ok": True, "id": res["last_id"]}
    cfg = _get_conn_config(session["effective_user"], body.conn_id)
    dialect = _dialect_for(cfg["db_type"])
    last_id = _call(dialect, cfg, "insert_row", body.database, body.table, body.values)
    return {"ok": True, "id": last_id}


class BulkDeleteBody(BaseModel):
    conn_id: str
    database: str
    table: str
    mode: str = "page"
    where_rows: Optional[list] = None


@router.post("/bulk-delete")
def bulk_delete(body: BulkDeleteBody, session=Depends(get_current_session)):
    if _is_sqlite_conn(body.conn_id):
        path = _resolve_sqlite_path(body.conn_id, body.database)
        deleted = 0
        if body.mode == "all":
            deleted = _sqlite_write(path, f"DELETE FROM `{body.table}`", [])["affected"]
        elif body.where_rows:
            for where_dict in body.where_rows:
                where_sql, params = _where_sqlite(where_dict)
                deleted += _sqlite_write(path, f"DELETE FROM `{body.table}` WHERE {where_sql}", params)["affected"]
        return {"ok": True, "affected": deleted}
    cfg = _get_conn_config(session["effective_user"], body.conn_id)
    dialect = _dialect_for(cfg["db_type"])
    deleted = _call(dialect, cfg, "bulk_delete", body.database, body.table, body.mode, body.where_rows)
    return {"ok": True, "affected": deleted}


class BulkUpdateBody(BaseModel):
    conn_id: str
    database: str
    table: str
    updates: dict
    mode: str = "page"
    where_rows: Optional[list] = None


@router.post("/bulk-update")
def bulk_update(body: BulkUpdateBody, session=Depends(get_current_session)):
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
    dialect = _dialect_for(cfg["db_type"])
    affected = _call(dialect, cfg, "bulk_update", body.database, body.table, body.updates, body.mode, body.where_rows)
    return {"ok": True, "affected": affected}


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
    dialect = _dialect_for(cfg["db_type"])
    res = _call(dialect, cfg, "get_table_data", body.database, body.table, body.limit, body.offset,
                body.search, body.order_by, body.order_dir, body.filters, body.sort)
    if res.get("rows"):
        res["rows"] = dialect_common.json_safe_rows(res["rows"])
    return JSONResponse(res)


class UpdateCellBody(BaseModel):
    conn_id: str
    database: str
    table: str
    where: dict
    column: str
    value: Optional[str] = None


@router.post("/update-cell")
def update_cell(body: UpdateCellBody, session=Depends(get_current_session)):
    if _is_sqlite_conn(body.conn_id):
        path = _resolve_sqlite_path(body.conn_id, body.database)
        where_sql, params = _where_sqlite(body.where)
        _sqlite_write(path, f"UPDATE `{body.table}` SET `{body.column}`=? WHERE {where_sql}",
                      [body.value] + params)
        return {"ok": True}
    cfg = _get_conn_config(session["effective_user"], body.conn_id)
    dialect = _dialect_for(cfg["db_type"])
    _call(dialect, cfg, "update_cell", body.database, body.table, body.where, body.column, body.value)
    return {"ok": True}


class DeleteRowBody(BaseModel):
    conn_id: str
    database: str
    table: str
    where: Optional[dict] = None
    primary_key: Optional[str] = None
    primary_value: Optional[str] = None


@router.post("/delete-row")
def delete_row(body: DeleteRowBody, session=Depends(get_current_session)):
    if _is_sqlite_conn(body.conn_id):
        path = _resolve_sqlite_path(body.conn_id, body.database)
        if body.where:
            where_sql, params = _where_sqlite(body.where)
        else:
            where_sql, params = f"`{body.primary_key}`=?", [body.primary_value]
        _sqlite_write(path, f"DELETE FROM `{body.table}` WHERE {where_sql}", params)
        return {"ok": True}
    cfg = _get_conn_config(session["effective_user"], body.conn_id)
    dialect = _dialect_for(cfg["db_type"])
    _call(dialect, cfg, "delete_row", body.database, body.table, body.where, body.primary_key, body.primary_value)
    return {"ok": True}


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
    dialect = _dialect_for(cfg["db_type"])
    res = _call(dialect, cfg, "table_structure", database, table)
    return JSONResponse(res)


# ── Create Table ─────────────────────────────────────────────────────────────

_VALID_ID = re.compile(r'^[a-zA-Z0-9_\-\.]+$')


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
    if not _VALID_ID.match(db) or not re.match(r'^[a-zA-Z0-9_]+$', tbl):
        raise HTTPException(400, "Invalid table name")
    dialect = _dialect_for(cfg["db_type"])
    sql = _call(dialect, cfg, "create_table", db, tbl, body.columns,
                engine=body.engine, collation=body.collation, comment=body.comment)
    return JSONResponse({"ok": True, "sql": sql})


# ── Alter Table ───────────────────────────────────────────────────────────────

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
    dialect = _dialect_for(cfg["db_type"])
    sql = _call(dialect, cfg, "alter_table", db, tbl, body.columns)
    if not sql:
        return JSONResponse({"success": True, "message": "No changes"})
    return JSONResponse({"success": True, "sql": sql})


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
    dialect = _dialect_for(cfg["db_type"])
    sql = _call(dialect, cfg, "manage_indexes", db, tbl, body.action,
                name=body.name, type_=body.type, columns=body.columns)
    return JSONResponse({"success": True, "sql": sql})


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
    dialect = _dialect_for(cfg["db_type"])
    sql = _call(dialect, cfg, "manage_foreign_keys", db, tbl, body.action,
                name=body.name, columns=body.columns, ref_db=body.ref_db, ref_table=body.ref_table,
                ref_cols=body.ref_cols, on_update=body.on_update, on_delete=body.on_delete)
    return JSONResponse({"success": True, "sql": sql})


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
    clean = []
    for tbl in body.tables:
        tbl = tbl.strip()
        if not re.match(r'^[a-zA-Z0-9_]+$', tbl):
            raise HTTPException(400, f"Invalid table name: {tbl}")
        clean.append(tbl)
    dialect = _dialect_for(cfg["db_type"])
    _call(dialect, cfg, "manage_tables", db, op, clean)
    return JSONResponse({"ok": True, "tables": clean})


# ── Export ────────────────────────────────────────────────────────────────────

@router.get("/export")
def export_table(conn_id: str, database: str, table: str, format: str = "sql",
                 session=Depends(get_current_session)):
    cfg = _get_conn_config(session["effective_user"], conn_id)
    dialect = _dialect_for(cfg["db_type"])
    columns, rows = _call(dialect, cfg, "export_rows", database, table)

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
        col_list = ", ".join([dialect.quote_ident(c) for c in columns])
        qtable = dialect.quote_ident(table)
        for row in rows:
            vals = [dialect.escape_literal(row.get(c)) for c in columns]
            lines.append(f"INSERT INTO {qtable} ({col_list}) VALUES ({', '.join(vals)});\n")
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
    dialect = _dialect_for(cfg["db_type"])
    table_list = [t.strip() for t in tables.split(",") if t.strip()]
    do_zip = zip == "1"
    do_structure = mode in ("structure_data", "structure")
    do_data = mode in ("structure_data", "data")

    if format == "csv":
        import csv as _csv, io as _io, zipfile as _zf
        if do_zip:
            buf = _io.BytesIO()
            with _zf.ZipFile(buf, "w", _zf.ZIP_DEFLATED) as zf:
                for tbl in table_list:
                    cols, rows = _call(dialect, cfg, "export_rows", database, tbl)
                    out = _io.StringIO()
                    w = _csv.writer(out)
                    w.writerow(cols)
                    for row in rows:
                        w.writerow([row.get(c, "") for c in cols])
                    zf.writestr(tbl + ".csv", out.getvalue())
            buf.seek(0)
            return StreamingResponse(buf, media_type="application/zip",
                headers={"Content-Disposition": f"attachment; filename={database}.zip"})
        else:
            tbl = table_list[0]
            cols, rows = _call(dialect, cfg, "export_rows", database, tbl)
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
                ddl = _call(dialect, cfg, "export_table_ddl", database, tbl)
                if ddl:
                    lines.append(ddl + "\n\n")
            if do_data:
                cols, rows = _call(dialect, cfg, "export_rows", database, tbl)
                if rows:
                    col_list = ", ".join([dialect.quote_ident(c) for c in cols])
                    qtable = dialect.quote_ident(tbl)
                    for row in rows:
                        vals = [dialect.escape_literal(row.get(c)) for c in cols]
                        lines.append(f"INSERT INTO {qtable} ({col_list}) VALUES ({', '.join(vals)});\n")
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
            content = header + "\n".join([_table_sql(t) for t in table_list])
            return StreamingResponse(iter([content.encode()]), media_type="application/sql",
                headers={"Content-Disposition": f"attachment; filename={database}.sql"})


# ── Import ────────────────────────────────────────────────────────────────────

from fastapi import UploadFile, File, Form


def _run_cli_import(dialect, cfg, database, path):
    """Pipe a raw .sql file straight into the DB's own CLI client — one process, no memory load."""
    args = dialect.cli_args(cfg, database)
    env = dialect.cli_env(cfg)
    try:
        with open(path, "r", errors="replace") as f:
            r = subprocess.run(args, stdin=f, capture_output=True, text=True, timeout=3600, env=env)
    except FileNotFoundError:
        raise HTTPException(400, f"'{args[0]}' CLI is not installed on the server")
    if r.returncode != 0:
        raise HTTPException(400, dialect.clean_cli_stderr(r.stderr.strip()))


def _import_csv_rows(dialect, cfg, database, table, rows):
    affected, errors = 0, []
    for row in rows:
        try:
            dialect.insert_row(cfg, database, table, dict(row))
            affected += 1
        except Exception as e:
            errors.append(str(e))
    return affected, errors


@router.post("/import")
async def import_file(
    conn_id: str = Form(...),
    database: str = Form(...),
    file: UploadFile = File(...),
    session=Depends(get_current_session)
):
    import tempfile
    cfg = _get_conn_config(session["effective_user"], conn_id)
    dialect = _dialect_for(cfg["db_type"])
    filename = file.filename or ""
    errors = []
    affected = 0

    tmp_path = None
    try:
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
                affected, errors = _import_csv_rows(dialect, cfg, database, table, rows)
        else:
            _run_cli_import(dialect, cfg, database, tmp_path)
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
    dialect = _dialect_for(cfg["db_type"])
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
                    affected, errors = _import_csv_rows(dialect, cfg, body.database, table, rows)
            else:
                try:
                    args = dialect.cli_args(cfg, body.database)
                    env = dialect.cli_env(cfg)
                    with open(real, "r", errors="replace") as f:
                        r = subprocess.run(args, stdin=f, capture_output=True, text=True, timeout=7200, env=env)
                    if r.returncode != 0:
                        errors = [dialect.clean_cli_stderr(r.stderr.strip())]
                    else:
                        with open(real, "rb") as f:
                            affected = f.read().count(b";")
                except FileNotFoundError:
                    errors = [f"CLI client for this database type is not installed on the server"]
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

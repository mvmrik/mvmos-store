"""
YourSQL — MySQL / MariaDB dialect (pymysql-based DB-API driver).
Implements the common dialect interface used by backend.py. Every function
here mirrors a function of the same name/signature in dialect_postgres.py.
"""

import re

try:
    import pymysql
    import pymysql.cursors
    _AVAILABLE = True
except ImportError:
    pymysql = None
    _AVAILABLE = False

DRIVER_MODULE = "pymysql"
DRIVER_PACKAGE = "pymysql"

_VALID_ID = re.compile(r'^[a-zA-Z0-9_\-\.]+$')
_PLAIN_ID = re.compile(r'^[a-zA-Z0-9_]+$')

_NO_DEFAULT_TYPES = {'TEXT', 'TINYTEXT', 'MEDIUMTEXT', 'LONGTEXT', 'BLOB', 'TINYBLOB', 'MEDIUMBLOB', 'LONGBLOB', 'JSON', 'GEOMETRY'}
_STRING_TYPES = {'CHAR', 'VARCHAR', 'TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'BINARY', 'VARBINARY', 'ENUM', 'SET'}
_NEEDS_LENGTH = {'TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'BIGINT', 'FLOAT', 'DOUBLE', 'DECIMAL', 'NUMERIC', 'CHAR', 'VARCHAR', 'BINARY', 'VARBINARY', 'BIT'}
_NEEDS_DECIMALS = {'FLOAT', 'DOUBLE', 'DECIMAL', 'NUMERIC'}
_NEEDS_ENUM = {'ENUM', 'SET'}
_CAN_UNSIGNED = {'TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'BIGINT', 'FLOAT', 'DOUBLE', 'DECIMAL', 'NUMERIC'}

OP_MAP = {
    '=': '=', '!=': '!=', '<': '<', '>': '>', '<=': '<=', '>=': '>=',
    'LIKE': 'LIKE', 'NOT LIKE': 'NOT LIKE', 'REGEXP': 'REGEXP',
}


def driver_available() -> bool:
    return _AVAILABLE


def _require_driver():
    if not _AVAILABLE:
        raise RuntimeError("driver_missing")


def quote_ident(name: str) -> str:
    return "`" + str(name).replace("`", "``") + "`"


def escape_literal(val) -> str:
    if val is None:
        return "NULL"
    s = str(val).replace("\\", "\\\\").replace("'", "\\'")
    return f"'{s}'"


def connect(cfg: dict, database: str = None):
    _require_driver()
    return pymysql.connect(
        host=cfg['host'], port=int(cfg['port']), user=cfg['user'], password=cfg.get('password', ''),
        database=database or None, charset='utf8mb4', cursorclass=pymysql.cursors.DictCursor,
        autocommit=True, connect_timeout=10,
    )


def _exec(cfg, database, sql, params=None):
    conn = connect(cfg, database)
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            return cur
    finally:
        conn.close()


def _fetch_all(cfg, database, sql, params=None):
    conn = connect(cfg, database)
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            return cur.fetchall()
    finally:
        conn.close()


def _write(cfg, database, sql, params=None):
    conn = connect(cfg, database)
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            return {"affected": cur.rowcount, "last_id": cur.lastrowid}
    finally:
        conn.close()


# ── Databases / tables ───────────────────────────────────────────────────────

def list_databases(cfg) -> list:
    rows = _fetch_all(cfg, None, "SHOW DATABASES")
    return [list(r.values())[0] for r in rows]


def create_database(cfg, name: str):
    _write(cfg, None, f"CREATE DATABASE {quote_ident(name)}")


def drop_database(cfg, name: str):
    _write(cfg, None, f"DROP DATABASE {quote_ident(name)}")


def list_tables(cfg, database: str) -> list:
    rows = _fetch_all(cfg, database, "SHOW TABLES")
    return [list(r.values())[0] for r in rows]


# ── Free-form query ──────────────────────────────────────────────────────────

def run_query(cfg, database, sql: str) -> dict:
    is_select = sql.strip().upper().startswith(("SELECT", "SHOW", "DESCRIBE", "EXPLAIN"))
    conn = connect(cfg, database or None)
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
            if is_select:
                rows = cur.fetchall() or []
                columns = list(rows[0].keys()) if rows else ([d[0] for d in cur.description] if cur.description else [])
                return {"columns": columns, "rows": rows, "affected": None}
            return {"columns": [], "rows": [], "affected": cur.rowcount}
    finally:
        conn.close()


# ── WHERE builder ────────────────────────────────────────────────────────────

def _build_where(filters, search=None, search_cols=None):
    parts, params = [], []
    if search and search_cols:
        sub = " OR ".join(f"{quote_ident(c)} LIKE %s" for c in search_cols)
        parts.append("(" + sub + ")")
        params.extend([f"%{search}%"] * len(search_cols))
    for f in (filters or []):
        col = f.get('col') if isinstance(f, dict) else f.col
        op = f.get('op') if isinstance(f, dict) else f.op
        val = f.get('val', '') if isinstance(f, dict) else getattr(f, 'val', '')
        qcol = quote_ident(col)
        if op == 'LIKE %%':
            parts.append(f"{qcol} LIKE %s")
            params.append(f"%{val}%")
        elif op in ('IS NULL', 'IS NOT NULL'):
            parts.append(f"{qcol} {op}")
        elif op in OP_MAP:
            parts.append(f"{qcol} {OP_MAP[op]} %s")
            params.append(val)
    return (" AND ".join(parts) if parts else ""), params


def _where_from_dict(where: dict):
    if not where:
        raise ValueError("Empty WHERE")
    parts, params = [], []
    for c, v in where.items():
        if v is None:
            parts.append(f"{quote_ident(c)} IS NULL")
        else:
            parts.append(f"{quote_ident(c)}=%s")
            params.append(v)
    return " AND ".join(parts), params


# ── Row CRUD ─────────────────────────────────────────────────────────────────

def get_table_data(cfg, database, table, limit, offset, search, order_by, order_dir, filters, sort):
    search_cols = []
    if search:
        cols_rows = _fetch_all(cfg, database, f"SHOW FULL COLUMNS FROM {quote_ident(table)}")
        search_cols = [c["Field"] for c in cols_rows if any(t in (c["Type"] or "").lower() for t in ("char", "text", "varchar"))]

    where_sql, where_params = _build_where(filters, search, search_cols)
    where = f"WHERE {where_sql}" if where_sql else ""

    count_rows = _fetch_all(cfg, database, f"SELECT COUNT(*) as cnt FROM {quote_ident(table)} {where}", where_params)
    total = int(count_rows[0]["cnt"]) if count_rows else 0

    order_parts = []
    if sort:
        for s in sort:
            col = s.get('col') if isinstance(s, dict) else s.col
            dir_ = "DESC" if (s.get('dir') if isinstance(s, dict) else s.dir).upper() == "DESC" else "ASC"
            order_parts.append(f"{quote_ident(col)} {dir_}")
    elif order_by:
        dir_ = "DESC" if order_dir.upper() == "DESC" else "ASC"
        order_parts.append(f"{quote_ident(order_by)} {dir_}")
    order = ("ORDER BY " + ", ".join(order_parts)) if order_parts else ""

    sql = f"SELECT * FROM {quote_ident(table)} {where} {order} LIMIT %s OFFSET %s"
    rows = _fetch_all(cfg, database, sql, where_params + [int(limit), int(offset)])
    columns = list(rows[0].keys()) if rows else []
    return {"columns": columns, "rows": rows, "total": total}


def update_row(cfg, database, table, where: dict, updates: dict) -> int:
    set_parts = [f"{quote_ident(c)}=%s" for c in updates]
    where_sql, where_params = _where_from_dict(where)
    sql = f"UPDATE {quote_ident(table)} SET {', '.join(set_parts)} WHERE {where_sql}"
    res = _write(cfg, database, sql, list(updates.values()) + where_params)
    return res["affected"]


def insert_row(cfg, database, table, values: dict):
    cols = list(values.keys())
    col_str = ", ".join(quote_ident(c) for c in cols)
    placeholders = ", ".join(["%s"] * len(cols))
    sql = f"INSERT INTO {quote_ident(table)} ({col_str}) VALUES ({placeholders})"
    res = _write(cfg, database, sql, list(values.values()))
    return res["last_id"]


def bulk_delete(cfg, database, table, mode, where_rows) -> int:
    if mode == "all":
        return _write(cfg, database, f"DELETE FROM {quote_ident(table)}")["affected"]
    deleted = 0
    for where_dict in (where_rows or []):
        where_sql, params = _where_from_dict(where_dict)
        deleted += _write(cfg, database, f"DELETE FROM {quote_ident(table)} WHERE {where_sql}", params)["affected"]
    return deleted


def _build_set_ops(updates: dict):
    set_parts, params = [], []
    for col, op_dict in updates.items():
        operation = op_dict.get("op", "set") if isinstance(op_dict, dict) else "set"
        val = op_dict.get("value") if isinstance(op_dict, dict) else op_dict
        qcol = quote_ident(col)
        if operation == "set_null" or (operation == "set" and val is None):
            set_parts.append(f"{qcol}=NULL")
        elif operation == "set":
            set_parts.append(f"{qcol}=%s")
            params.append(val)
        elif operation == "increment":
            set_parts.append(f"{qcol}={qcol}+%s")
            params.append(val)
        elif operation == "decrement":
            set_parts.append(f"{qcol}={qcol}-%s")
            params.append(val)
    return set_parts, params


def bulk_update(cfg, database, table, updates: dict, mode, where_rows) -> int:
    set_parts, set_params = _build_set_ops(updates)
    if not set_parts:
        raise ValueError("No operations")
    if mode == "all":
        sql = f"UPDATE {quote_ident(table)} SET {', '.join(set_parts)}"
        return _write(cfg, database, sql, set_params)["affected"]
    total = 0
    for where_dict in (where_rows or []):
        where_sql, wparams = _where_from_dict(where_dict)
        sql = f"UPDATE {quote_ident(table)} SET {', '.join(set_parts)} WHERE {where_sql}"
        total += _write(cfg, database, sql, set_params + wparams)["affected"]
    return total


def update_cell(cfg, database, table, where: dict, column, value):
    where_sql, where_params = _where_from_dict(where)
    sql = f"UPDATE {quote_ident(table)} SET {quote_ident(column)}=%s WHERE {where_sql}"
    _write(cfg, database, sql, [value] + where_params)


def delete_row(cfg, database, table, where: dict, primary_key=None, primary_value=None):
    if where:
        where_sql, params = _where_from_dict(where)
    else:
        where_sql, params = f"{quote_ident(primary_key)}=%s", [primary_value]
    _write(cfg, database, f"DELETE FROM {quote_ident(table)} WHERE {where_sql}", params)


# ── Table structure ──────────────────────────────────────────────────────────

def table_structure(cfg, database, table) -> dict:
    columns = _fetch_all(cfg, database, f"SHOW FULL COLUMNS FROM {quote_ident(table)}")
    indexes = _fetch_all(cfg, database, f"SHOW INDEX FROM {quote_ident(table)}")
    fk_sql = """
        SELECT kcu.CONSTRAINT_NAME AS name, kcu.COLUMN_NAME AS col,
               kcu.REFERENCED_TABLE_SCHEMA AS ref_db, kcu.REFERENCED_TABLE_NAME AS ref_table,
               kcu.REFERENCED_COLUMN_NAME AS ref_col, rc.UPDATE_RULE AS on_update, rc.DELETE_RULE AS on_delete
        FROM information_schema.KEY_COLUMN_USAGE kcu
        JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
            ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
            AND rc.CONSTRAINT_SCHEMA = kcu.TABLE_SCHEMA
            AND rc.TABLE_NAME = kcu.TABLE_NAME
        WHERE kcu.TABLE_SCHEMA = %s AND kcu.TABLE_NAME = %s
          AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
    """
    fk_rows = _fetch_all(cfg, None, fk_sql, [database, table])
    fks = {}
    for r in fk_rows:
        n = r["name"]
        if n not in fks:
            fks[n] = {"name": n, "columns": [], "ref_db": r["ref_db"], "ref_table": r["ref_table"],
                      "ref_cols": [], "on_update": r["on_update"], "on_delete": r["on_delete"]}
        fks[n]["columns"].append(r["col"])
        fks[n]["ref_cols"].append(r["ref_col"])
    return {"columns": columns, "indexes": indexes, "foreign_keys": list(fks.values())}


# ── Create / Alter table ─────────────────────────────────────────────────────

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


def _column_def(col: dict) -> str:
    name = (col.get("name") or "").strip()
    if not name or not _PLAIN_ID.match(name):
        raise ValueError(f"Invalid column name: {name}")
    base_type = (col.get("type") or col.get("baseType") or "VARCHAR").strip().upper()
    type_str = _build_type_str(base_type, col)
    allow_null = bool(col.get("allowNull"))
    null_str = "NULL" if allow_null else "NOT NULL"
    def_type = col.get("defaultType", "NULL")
    def_val = str(col.get("defaultValue", "") or "")
    auto_inc = bool(col.get("autoIncrement"))
    default_str = ""
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
            default_str = f"DEFAULT '{def_val.replace(chr(39), chr(39) * 2)}'"
    ai_str = "AUTO_INCREMENT" if auto_inc else ""
    collation = (col.get("collation") or "").strip()
    charset_str = ""
    if collation and _PLAIN_ID.match(collation):
        charset = collation.split("_")[0]
        charset_str = f"CHARACTER SET {charset} COLLATE {collation}"
    return f"{quote_ident(name)} {type_str} {charset_str} {null_str} {default_str} {ai_str}".strip()


def create_table(cfg, database, table, columns, engine="InnoDB", collation="", comment="") -> str:
    col_defs = []
    primary_cols = []
    for col in columns:
        col_defs.append(_column_def(col))
        if col.get("primary"):
            primary_cols.append(quote_ident((col.get("name") or "").strip()))
    if primary_cols:
        col_defs.append(f"PRIMARY KEY ({', '.join(primary_cols)})")
    engine_str = f"ENGINE={engine}" if engine else "ENGINE=InnoDB"
    collation_str = f"COLLATE={collation}" if collation else ""
    comment_str = f"COMMENT='{comment.replace(chr(39), chr(39) * 2)}'" if comment else ""
    options = " ".join(filter(None, [engine_str, collation_str, comment_str]))
    sql = f"CREATE TABLE {quote_ident(table)} (\n  " + ",\n  ".join(col_defs) + f"\n) {options};"
    _write(cfg, database, sql)
    return sql


def alter_table(cfg, database, table, columns) -> str:
    existing = _fetch_all(cfg, database, f"SHOW COLUMNS FROM {quote_ident(table)}")
    existing_names = [r["Field"] for r in existing]
    clauses = []
    prev = None
    for col in columns:
        orig_name = (col.get("originalName") or "").strip()
        new_name = (col.get("name") or "").strip()
        if not new_name:
            continue
        col_def = _column_def(col)
        pos_str = "FIRST" if prev is None else f"AFTER {quote_ident(prev)}"
        if orig_name and orig_name in existing_names:
            clauses.append(f"CHANGE {quote_ident(orig_name)} {col_def} {pos_str}")
        else:
            clauses.append(f"ADD COLUMN {col_def} {pos_str}")
        prev = new_name
    new_originals = [c.get("originalName", "") for c in columns if c.get("originalName")]
    for ex in existing_names:
        if ex not in new_originals:
            clauses.append(f"DROP COLUMN {quote_ident(ex)}")
    if not clauses:
        return ""
    sql = f"ALTER TABLE {quote_ident(table)} " + ", ".join(clauses)
    _write(cfg, database, sql)
    return sql


# ── Indexes ──────────────────────────────────────────────────────────────────

def manage_indexes(cfg, database, table, action, name=None, type_=None, columns=None) -> str:
    if action == "add":
        cols = columns or []
        if not cols:
            raise ValueError("At least one column is required")
        idx_type = (type_ or "INDEX").strip().upper()
        col_list = ", ".join(quote_ident(re.sub(r'[^a-zA-Z0-9_]', '', c)) for c in cols)
        name = (name or "").strip()
        if idx_type == "PRIMARY":
            sql = f"ALTER TABLE {quote_ident(table)} ADD PRIMARY KEY ({col_list})"
        elif idx_type == "UNIQUE":
            iname = name or "_".join(cols) + "_unique"
            sql = f"ALTER TABLE {quote_ident(table)} ADD UNIQUE INDEX {quote_ident(iname)} ({col_list})"
        elif idx_type == "FULLTEXT":
            iname = name or "_".join(cols) + "_fulltext"
            sql = f"ALTER TABLE {quote_ident(table)} ADD FULLTEXT INDEX {quote_ident(iname)} ({col_list})"
        else:
            iname = name or "_".join(cols) + "_idx"
            sql = f"ALTER TABLE {quote_ident(table)} ADD INDEX {quote_ident(iname)} ({col_list})"
        _write(cfg, database, sql)
        return sql
    elif action == "drop":
        name = (name or "").strip()
        if not name:
            raise ValueError("Index name is required")
        sql = (f"ALTER TABLE {quote_ident(table)} DROP PRIMARY KEY" if name == "PRIMARY"
               else f"ALTER TABLE {quote_ident(table)} DROP INDEX {quote_ident(name)}")
        _write(cfg, database, sql)
        return sql
    raise ValueError("Unknown action")


# ── Foreign keys ─────────────────────────────────────────────────────────────

def manage_foreign_keys(cfg, database, table, action, name=None, columns=None, ref_db=None,
                        ref_table=None, ref_cols=None, on_update="RESTRICT", on_delete="RESTRICT") -> str:
    if action == "add":
        cols = columns or []
        ref_db = (ref_db or database).strip()
        ref_table = (ref_table or "").strip()
        ref_cols = ref_cols or []
        on_update = (on_update or "RESTRICT").strip().upper()
        on_delete = (on_delete or "RESTRICT").strip().upper()
        if not cols or not ref_table or not ref_cols:
            raise ValueError("columns, ref_table and ref_cols are required")
        allowed = {"RESTRICT", "CASCADE", "SET NULL", "NO ACTION", "SET DEFAULT"}
        if on_update not in allowed:
            on_update = "RESTRICT"
        if on_delete not in allowed:
            on_delete = "RESTRICT"
        for ident in [ref_table, ref_db] + cols + ref_cols:
            if not _VALID_ID.match(ident):
                raise ValueError(f"Invalid identifier: {ident}")
        eng_rows = _fetch_all(cfg, None,
            "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s",
            [database, table])
        if eng_rows:
            engine = (eng_rows[0].get("ENGINE") or "").upper()
            if engine and engine != "INNODB":
                raise ValueError(f"Foreign keys require InnoDB. This table uses {engine}.")
        name = (name or "").strip()
        constraint = name or f"fk_{table}_{'_'.join(cols)}"
        col_list = ", ".join(quote_ident(c) for c in cols)
        ref_col_list = ", ".join(quote_ident(c) for c in ref_cols)
        sql = (f"ALTER TABLE {quote_ident(table)} ADD CONSTRAINT {quote_ident(constraint)} "
               f"FOREIGN KEY ({col_list}) REFERENCES {quote_ident(ref_db)}.{quote_ident(ref_table)} ({ref_col_list}) "
               f"ON UPDATE {on_update} ON DELETE {on_delete}")
        _write(cfg, database, sql)
        return sql
    elif action == "drop":
        name = (name or "").strip()
        if not name or not re.match(r'^[a-zA-Z0-9_\-]+$', name):
            raise ValueError("Invalid constraint name")
        sql = f"ALTER TABLE {quote_ident(table)} DROP FOREIGN KEY {quote_ident(name)}"
        _write(cfg, database, sql)
        return sql
    raise ValueError("Unknown action")


# ── Manage tables (truncate/drop/analyze/optimize/check/repair) ─────────────

SUPPORTED_OPS = {"TRUNCATE", "DROP", "ANALYZE", "OPTIMIZE", "CHECK", "REPAIR"}


def manage_tables(cfg, database, operation, tables):
    op = operation.strip().upper()
    if op not in SUPPORTED_OPS:
        raise ValueError("Invalid operation")
    if op == "DROP":
        # pymysql doesn't run multiple ;-separated statements in one execute() call
        # (needs CLIENT.MULTI_STATEMENTS) — issue each as its own statement instead.
        conn = connect(cfg, database)
        try:
            with conn.cursor() as cur:
                cur.execute("SET FOREIGN_KEY_CHECKS=0")
                for t in tables:
                    cur.execute(f"DROP TABLE {quote_ident(t)}")
                cur.execute("SET FOREIGN_KEY_CHECKS=1")
        finally:
            conn.close()
    else:
        for t in tables:
            sql = f"TRUNCATE TABLE {quote_ident(t)};" if op == "TRUNCATE" else f"{op} TABLE {quote_ident(t)};"
            _write(cfg, database, sql)


# ── Export ───────────────────────────────────────────────────────────────────

def export_rows(cfg, database, table):
    rows = _fetch_all(cfg, database, f"SELECT * FROM {quote_ident(table)}")
    columns = list(rows[0].keys()) if rows else []
    return columns, rows


def export_table_ddl(cfg, database, table) -> str:
    rows = _fetch_all(cfg, database, f"SHOW CREATE TABLE {quote_ident(table)}")
    if rows:
        return rows[0].get("Create Table", "") + ";"
    return ""


# ── CLI passthrough (for raw .sql import — piping is more robust than parsing) ─

def cli_args(cfg: dict, database: str = None) -> list:
    args = [
        "mysql", f"-h{cfg['host']}", f"-P{cfg['port']}", f"-u{cfg['user']}", f"-p{cfg.get('password', '')}",
        "--batch", "--default-character-set=utf8mb4",
    ]
    if database:
        args.append(database)
    return args


def clean_cli_stderr(err: str) -> str:
    lines = [l for l in err.splitlines() if "Using a password" not in l]
    return "\n".join(lines) or err


def cli_env(cfg: dict) -> dict:
    import os
    return os.environ.copy()

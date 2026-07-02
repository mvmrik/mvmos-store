"""
YourSQL — PostgreSQL dialect (psycopg2-based DB-API driver).
Also covers CockroachDB, Google Cloud SQL - PostgreSQL, and Greenplum, which all
speak the PostgreSQL wire protocol / SQL dialect for the operations this app needs.

Implements the common dialect interface used by backend.py (same function names
and signatures as dialect_mysql.py). Where MySQL has no direct analogue (SHOW
FULL COLUMNS, SHOW INDEX, SHOW CREATE TABLE, AUTO_INCREMENT, ENGINE, FULLTEXT
index, CHECK/REPAIR TABLE) this module normalizes results into the same shape
MySQL produces (Field/Type/Null/Key/Default/Extra/Collation/Comment for columns,
Key_name/Column_name/Non_unique/Index_type for indexes) so the existing frontend
code (structure.js) works unmodified against either dialect.
"""

import re

try:
    import psycopg2
    import psycopg2.extras
    _AVAILABLE = True
except ImportError:
    psycopg2 = None
    _AVAILABLE = False

DRIVER_MODULE = "psycopg2"
DRIVER_PACKAGE = "psycopg2-binary"

_VALID_ID = re.compile(r'^[a-zA-Z0-9_\-\.]+$')
_PLAIN_ID = re.compile(r'^[a-zA-Z0-9_]+$')

_NEEDS_LENGTH = {'VARCHAR', 'CHAR'}
_NEEDS_DECIMALS = {'NUMERIC', 'DECIMAL'}
_STRING_TYPES = {'VARCHAR', 'CHAR', 'TEXT'}
_NO_DEFAULT_TYPES = {'TEXT', 'JSON', 'JSONB', 'BYTEA'}
_SERIAL_MAP = {'SMALLINT': 'SMALLSERIAL', 'INTEGER': 'SERIAL', 'INT': 'SERIAL', 'BIGINT': 'BIGSERIAL'}

OP_MAP = {
    '=': '=', '!=': '!=', '<': '<', '>': '>', '<=': '<=', '>=': '>=',
    'LIKE': 'LIKE', 'NOT LIKE': 'NOT LIKE', 'REGEXP': '~',
}

# information_schema.columns.data_type -> canonical short type name used by the frontend
_PG_TYPE_TO_BASE = {
    'character varying': 'VARCHAR',
    'character': 'CHAR',
    'text': 'TEXT',
    'integer': 'INTEGER',
    'bigint': 'BIGINT',
    'smallint': 'SMALLINT',
    'numeric': 'NUMERIC',
    'real': 'REAL',
    'double precision': 'DOUBLE PRECISION',
    'boolean': 'BOOLEAN',
    'date': 'DATE',
    'timestamp without time zone': 'TIMESTAMP',
    'timestamp with time zone': 'TIMESTAMPTZ',
    'time without time zone': 'TIME',
    'time with time zone': 'TIME',
    'json': 'JSON',
    'jsonb': 'JSONB',
    'uuid': 'UUID',
    'bytea': 'BYTEA',
}


def driver_available() -> bool:
    return _AVAILABLE


def _require_driver():
    if not _AVAILABLE:
        raise RuntimeError("driver_missing")


def quote_ident(name: str) -> str:
    return '"' + str(name).replace('"', '""') + '"'


def escape_literal(val) -> str:
    if val is None:
        return "NULL"
    s = str(val).replace("'", "''")
    return f"'{s}'"


def connect(cfg: dict, database: str = None):
    _require_driver()
    db = database or cfg.get('database') or 'postgres'
    return psycopg2.connect(
        host=cfg['host'], port=int(cfg['port']), user=cfg['user'], password=cfg.get('password', ''),
        dbname=db, connect_timeout=10,
    )


def _admin_connect(cfg: dict):
    _require_driver()
    conn = psycopg2.connect(
        host=cfg['host'], port=int(cfg['port']), user=cfg['user'], password=cfg.get('password', ''),
        dbname='postgres', connect_timeout=10,
    )
    conn.autocommit = True
    return conn


def _fetch_all(cfg, database, sql, params=None):
    conn = connect(cfg, database)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params or None)
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def _write(cfg, database, sql, params=None):
    conn = connect(cfg, database)
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(sql, params or None)
            return cur.rowcount
    finally:
        conn.close()


def _run_statements(cfg, database, statements):
    """Run several statements in one transaction (used by alter_table)."""
    conn = connect(cfg, database)
    try:
        with conn.cursor() as cur:
            for sql in statements:
                cur.execute(sql)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ── Databases / tables ───────────────────────────────────────────────────────

def list_databases(cfg) -> list:
    conn = _admin_connect(cfg)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname")
            return [r[0] for r in cur.fetchall()]
    finally:
        conn.close()


def create_database(cfg, name: str):
    conn = _admin_connect(cfg)
    try:
        with conn.cursor() as cur:
            cur.execute(f"CREATE DATABASE {quote_ident(name)}")
    finally:
        conn.close()


def drop_database(cfg, name: str):
    conn = _admin_connect(cfg)
    try:
        with conn.cursor() as cur:
            cur.execute(f"DROP DATABASE {quote_ident(name)}")
    finally:
        conn.close()


def list_tables(cfg, database: str) -> list:
    rows = _fetch_all(cfg, database, "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")
    return [r["tablename"] for r in rows]


# ── Free-form query ──────────────────────────────────────────────────────────

def run_query(cfg, database, sql: str) -> dict:
    conn = connect(cfg, database or None)
    try:
        conn.autocommit = True
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql)
            if cur.description is not None:
                rows = [dict(r) for r in cur.fetchall()]
                columns = list(rows[0].keys()) if rows else [d.name for d in cur.description]
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


def _primary_key_columns(cfg, database, table) -> list:
    rows = _fetch_all(cfg, database, """
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema='public' AND tc.table_name = %s
        ORDER BY kcu.ordinal_position
    """, [table])
    return [r["column_name"] for r in rows]


# ── Row CRUD ─────────────────────────────────────────────────────────────────

def get_table_data(cfg, database, table, limit, offset, search, order_by, order_dir, filters, sort):
    search_cols = []
    if search:
        cols_rows = _fetch_all(cfg, database,
            "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=%s",
            [table])
        search_cols = [c["column_name"] for c in cols_rows if c["data_type"] in ("character varying", "character", "text")]

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
    return _write(cfg, database, sql, list(updates.values()) + where_params)


def insert_row(cfg, database, table, values: dict):
    cols = list(values.keys())
    col_str = ", ".join(quote_ident(c) for c in cols)
    placeholders = ", ".join(["%s"] * len(cols))
    sql = f"INSERT INTO {quote_ident(table)} ({col_str}) VALUES ({placeholders}) RETURNING *"
    conn = connect(cfg, database)
    try:
        conn.autocommit = True
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, list(values.values()))
            row = cur.fetchone()
    finally:
        conn.close()
    if not row:
        return None
    pk_cols = _primary_key_columns(cfg, database, table)
    if pk_cols and pk_cols[0] in row:
        return row[pk_cols[0]]
    return None


def bulk_delete(cfg, database, table, mode, where_rows) -> int:
    if mode == "all":
        return _write(cfg, database, f"DELETE FROM {quote_ident(table)}")
    deleted = 0
    for where_dict in (where_rows or []):
        where_sql, params = _where_from_dict(where_dict)
        deleted += _write(cfg, database, f"DELETE FROM {quote_ident(table)} WHERE {where_sql}", params)
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
        return _write(cfg, database, sql, set_params)
    total = 0
    for where_dict in (where_rows or []):
        where_sql, wparams = _where_from_dict(where_dict)
        sql = f"UPDATE {quote_ident(table)} SET {', '.join(set_parts)} WHERE {where_sql}"
        total += _write(cfg, database, sql, set_params + wparams)
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


# ── Table structure (normalized to the MySQL SHOW-style shape) ──────────────

def table_structure(cfg, database, table) -> dict:
    col_rows = _fetch_all(cfg, database, """
        SELECT
          c.column_name, c.data_type, c.character_maximum_length,
          c.numeric_precision, c.numeric_scale, c.is_nullable, c.column_default,
          c.is_identity, c.collation_name,
          pgd.description AS comment
        FROM information_schema.columns c
        LEFT JOIN pg_catalog.pg_statio_all_tables st
          ON st.schemaname = c.table_schema AND st.relname = c.table_name
        LEFT JOIN pg_catalog.pg_description pgd
          ON pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position
        WHERE c.table_schema = 'public' AND c.table_name = %s
        ORDER BY c.ordinal_position
    """, [table])

    pk_cols = set(_primary_key_columns(cfg, database, table))

    columns = []
    for r in col_rows:
        base = _PG_TYPE_TO_BASE.get(r["data_type"], r["data_type"].upper())
        type_disp = base
        if base in ("VARCHAR", "CHAR") and r["character_maximum_length"]:
            type_disp = f"{base}({r['character_maximum_length']})"
        elif base in ("NUMERIC",) and r["numeric_precision"] is not None and r["numeric_scale"] is not None:
            type_disp = f"{base}({r['numeric_precision']},{r['numeric_scale']})"
        is_identity = (r["is_identity"] == "YES") or (r["column_default"] and "nextval(" in str(r["column_default"]))
        default_val = r["column_default"]
        if is_identity:
            default_val = None
        columns.append({
            "Field": r["column_name"],
            "Type": type_disp.lower(),
            "Null": "YES" if r["is_nullable"] == "YES" else "NO",
            "Key": "PRI" if r["column_name"] in pk_cols else "",
            "Default": default_val,
            "Extra": "auto_increment" if is_identity else "",
            "Collation": r["collation_name"] or "",
            "Comment": r["comment"] or "",
            "Privileges": "",
        })

    idx_rows = _fetch_all(cfg, database, """
        SELECT i.relname AS index_name, a.attname AS column_name,
               ix.indisunique AS is_unique, ix.indisprimary AS is_primary,
               am.amname AS index_type,
               array_position(ix.indkey, a.attnum) AS col_pos
        FROM pg_index ix
        JOIN pg_class t ON t.oid = ix.indrelid
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_am am ON am.oid = i.relam
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
        WHERE t.relname = %s AND t.relnamespace = 'public'::regnamespace
        ORDER BY i.relname, col_pos
    """, [table])
    indexes = []
    for r in idx_rows:
        indexes.append({
            "Key_name": "PRIMARY" if r["is_primary"] else r["index_name"],
            "Column_name": r["column_name"],
            "Non_unique": 0 if r["is_unique"] else 1,
            "Index_type": (r["index_type"] or "btree").upper(),
        })

    fk_rows = _fetch_all(cfg, database, """
        SELECT tc.constraint_name AS name, kcu.column_name AS col,
               ccu.table_name AS ref_table, ccu.column_name AS ref_col,
               rc.update_rule AS on_update, rc.delete_rule AS on_delete
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
        JOIN information_schema.referential_constraints rc
          ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema='public' AND tc.table_name=%s
        ORDER BY tc.constraint_name, kcu.ordinal_position
    """, [table])
    fks = {}
    for r in fk_rows:
        n = r["name"]
        if n not in fks:
            fks[n] = {"name": n, "columns": [], "ref_db": database, "ref_table": r["ref_table"],
                      "ref_cols": [], "on_update": r["on_update"], "on_delete": r["on_delete"]}
        if r["col"] not in fks[n]["columns"]:
            fks[n]["columns"].append(r["col"])
        if r["ref_col"] not in fks[n]["ref_cols"]:
            fks[n]["ref_cols"].append(r["ref_col"])
    return {"columns": columns, "indexes": indexes, "foreign_keys": list(fks.values())}


# ── Create / Alter table ─────────────────────────────────────────────────────

def _build_type_str(base: str, col: dict) -> str:
    length = str(col.get("length", "") or "").strip()
    decimals = str(col.get("decimals", "") or "").strip()
    if base in _NEEDS_DECIMALS and length and decimals:
        return f"{base}({length},{decimals})"
    if base in _NEEDS_LENGTH and length:
        return f"{base}({length})"
    return base


def _column_def(col: dict, for_alter=False) -> str:
    name = (col.get("name") or "").strip()
    if not name or not _PLAIN_ID.match(name):
        raise ValueError(f"Invalid column name: {name}")
    base_type = (col.get("type") or col.get("baseType") or "VARCHAR").strip().upper()
    auto_inc = bool(col.get("autoIncrement"))
    allow_null = bool(col.get("allowNull"))
    def_type = col.get("defaultType", "NULL")
    def_val = str(col.get("defaultValue", "") or "")

    if auto_inc and base_type in _SERIAL_MAP:
        type_str = _SERIAL_MAP[base_type]
        return f"{quote_ident(name)} {type_str} PRIMARY KEY".strip() if col.get("primary") else f"{quote_ident(name)} {type_str}"

    type_str = _build_type_str(base_type, col)
    null_str = "NULL" if allow_null else "NOT NULL"
    default_str = ""
    if base_type not in _NO_DEFAULT_TYPES:
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
    return f"{quote_ident(name)} {type_str} {null_str} {default_str}".strip()


def create_table(cfg, database, table, columns, engine=None, collation=None, comment="") -> str:
    qt = quote_ident(table)
    col_defs = []
    primary_cols = []
    for col in columns:
        col_defs.append(_column_def(col))
        if col.get("primary") and not (bool(col.get("autoIncrement")) and (col.get("type") or col.get("baseType") or "").strip().upper() in _SERIAL_MAP):
            primary_cols.append(quote_ident((col.get("name") or "").strip()))
    if primary_cols:
        col_defs.append(f"PRIMARY KEY ({', '.join(primary_cols)})")
    sql = f"CREATE TABLE {qt} (\n  " + ",\n  ".join(col_defs) + "\n);"

    statements = [sql]
    if comment:
        statements.append(f"COMMENT ON TABLE {qt} IS '{comment.replace(chr(39), chr(39) * 2)}'")
    for col in columns:
        c = (col.get("comment") or "").strip()
        if c:
            cname = (col.get("name") or "").strip()
            statements.append(f"COMMENT ON COLUMN {qt}.{quote_ident(cname)} IS '{c.replace(chr(39), chr(39) * 2)}'")
    _run_statements(cfg, database, statements)
    return ";\n".join(statements)


def alter_table(cfg, database, table, columns) -> str:
    qt = quote_ident(table)
    existing_cols = {r["Field"]: r for r in table_structure(cfg, database, table)["columns"]}
    existing_names = list(existing_cols.keys())
    statements = []

    for col in columns:
        orig_name = (col.get("originalName") or "").strip()
        new_name = (col.get("name") or "").strip()
        if not new_name:
            continue
        base_type = (col.get("baseType") or col.get("type") or "VARCHAR").strip().upper()
        allow_null = bool(col.get("allowNull"))
        def_type = col.get("defaultType", "NULL")
        def_val = str(col.get("defaultValue", "") or "")
        auto_inc = bool(col.get("autoIncrement"))

        if orig_name and orig_name in existing_names:
            ref = orig_name
            was_identity = existing_cols.get(orig_name, {}).get("Extra") == "auto_increment"
            if new_name != orig_name:
                statements.append(f"ALTER TABLE {qt} RENAME COLUMN {quote_ident(orig_name)} TO {quote_ident(new_name)}")
                ref = new_name
            type_str = _build_type_str(base_type, col)
            statements.append(f"ALTER TABLE {qt} ALTER COLUMN {quote_ident(ref)} TYPE {type_str} USING {quote_ident(ref)}::{type_str}")
            statements.append(f"ALTER TABLE {qt} ALTER COLUMN {quote_ident(ref)} {'DROP NOT NULL' if allow_null else 'SET NOT NULL'}")
            if auto_inc and not was_identity:
                statements.append(f"ALTER TABLE {qt} ALTER COLUMN {quote_ident(ref)} ADD GENERATED BY DEFAULT AS IDENTITY")
            elif not auto_inc and was_identity:
                statements.append(f"ALTER TABLE {qt} ALTER COLUMN {quote_ident(ref)} DROP IDENTITY IF EXISTS")
            elif not auto_inc:
                if def_type in ("NULL", "NONE"):
                    statements.append(f"ALTER TABLE {qt} ALTER COLUMN {quote_ident(ref)} DROP DEFAULT")
                elif def_type == "EMPTY" and base_type in _STRING_TYPES:
                    statements.append(f"ALTER TABLE {qt} ALTER COLUMN {quote_ident(ref)} SET DEFAULT ''")
                elif def_type == "CURRENT_TIMESTAMP":
                    statements.append(f"ALTER TABLE {qt} ALTER COLUMN {quote_ident(ref)} SET DEFAULT CURRENT_TIMESTAMP")
                elif def_type == "VALUE" and def_val:
                    escaped = def_val.replace("'", "''")
                    statements.append(f"ALTER TABLE {qt} ALTER COLUMN {quote_ident(ref)} SET DEFAULT '{escaped}'")
            if col.get("comment"):
                c = col["comment"].replace("'", "''")
                statements.append(f"COMMENT ON COLUMN {qt}.{quote_ident(ref)} IS '{c}'")
        else:
            statements.append(f"ALTER TABLE {qt} ADD COLUMN {_column_def(col)}")
            if col.get("comment"):
                c = col["comment"].replace("'", "''")
                statements.append(f"COMMENT ON COLUMN {qt}.{quote_ident(new_name)} IS '{c}'")

    new_originals = [c.get("originalName", "") for c in columns if c.get("originalName")]
    for ex in existing_names:
        if ex not in new_originals:
            statements.append(f"ALTER TABLE {qt} DROP COLUMN {quote_ident(ex)}")

    if not statements:
        return ""
    _run_statements(cfg, database, statements)
    return ";\n".join(statements)


# ── Indexes ──────────────────────────────────────────────────────────────────

def manage_indexes(cfg, database, table, action, name=None, type_=None, columns=None) -> str:
    qt = quote_ident(table)
    if action == "add":
        cols = columns or []
        if not cols:
            raise ValueError("At least one column is required")
        idx_type = (type_ or "INDEX").strip().upper()
        col_list = ", ".join(quote_ident(re.sub(r'[^a-zA-Z0-9_]', '', c)) for c in cols)
        name = (name or "").strip()
        if idx_type == "PRIMARY":
            sql = f"ALTER TABLE {qt} ADD PRIMARY KEY ({col_list})"
        elif idx_type == "UNIQUE":
            iname = name or "_".join(cols) + "_unique"
            sql = f"CREATE UNIQUE INDEX {quote_ident(iname)} ON {qt} ({col_list})"
        elif idx_type == "FULLTEXT":
            raise ValueError("FULLTEXT indexes are not supported on PostgreSQL — use a GIN index on a tsvector column instead")
        else:
            iname = name or "_".join(cols) + "_idx"
            sql = f"CREATE INDEX {quote_ident(iname)} ON {qt} ({col_list})"
        _write(cfg, database, sql)
        return sql
    elif action == "drop":
        name = (name or "").strip()
        if not name:
            raise ValueError("Index name is required")
        if name == "PRIMARY":
            rows = _fetch_all(cfg, database, """
                SELECT constraint_name FROM information_schema.table_constraints
                WHERE constraint_type='PRIMARY KEY' AND table_schema='public' AND table_name=%s
            """, [table])
            if not rows:
                raise ValueError("No primary key found")
            sql = f"ALTER TABLE {qt} DROP CONSTRAINT {quote_ident(rows[0]['constraint_name'])}"
        else:
            sql = f"DROP INDEX {quote_ident(name)}"
        _write(cfg, database, sql)
        return sql
    raise ValueError("Unknown action")


# ── Foreign keys ─────────────────────────────────────────────────────────────

def manage_foreign_keys(cfg, database, table, action, name=None, columns=None, ref_db=None,
                        ref_table=None, ref_cols=None, on_update="RESTRICT", on_delete="RESTRICT") -> str:
    qt = quote_ident(table)
    if action == "add":
        cols = columns or []
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
        for ident in [ref_table] + cols + ref_cols:
            if not _VALID_ID.match(ident):
                raise ValueError(f"Invalid identifier: {ident}")
        name = (name or "").strip()
        constraint = name or f"fk_{table}_{'_'.join(cols)}"
        col_list = ", ".join(quote_ident(c) for c in cols)
        ref_col_list = ", ".join(quote_ident(c) for c in ref_cols)
        sql = (f"ALTER TABLE {qt} ADD CONSTRAINT {quote_ident(constraint)} "
               f"FOREIGN KEY ({col_list}) REFERENCES {quote_ident(ref_table)} ({ref_col_list}) "
               f"ON UPDATE {on_update} ON DELETE {on_delete}")
        _write(cfg, database, sql)
        return sql
    elif action == "drop":
        name = (name or "").strip()
        if not name or not re.match(r'^[a-zA-Z0-9_\-]+$', name):
            raise ValueError("Invalid constraint name")
        sql = f"ALTER TABLE {qt} DROP CONSTRAINT {quote_ident(name)}"
        _write(cfg, database, sql)
        return sql
    raise ValueError("Unknown action")


# ── Manage tables (truncate/drop/analyze/optimize/check/repair) ─────────────

SUPPORTED_OPS = {"TRUNCATE", "DROP", "ANALYZE", "OPTIMIZE"}
ALL_OPS = {"TRUNCATE", "DROP", "ANALYZE", "OPTIMIZE", "CHECK", "REPAIR"}


def manage_tables(cfg, database, operation, tables):
    op = operation.strip().upper()
    if op not in ALL_OPS:
        raise ValueError("Invalid operation")
    if op in ("CHECK", "REPAIR"):
        raise ValueError("PostgreSQL does not support CHECK/REPAIR TABLE (not needed — it uses WAL-based crash recovery)")
    qtables = [quote_ident(t) for t in tables]
    if op == "DROP":
        _write(cfg, database, f"DROP TABLE {', '.join(qtables)} CASCADE;")
    elif op == "TRUNCATE":
        _write(cfg, database, f"TRUNCATE TABLE {', '.join(qtables)} CASCADE;")
    elif op == "ANALYZE":
        for qt in qtables:
            _write(cfg, database, f"ANALYZE {qt};")
    elif op == "OPTIMIZE":
        for qt in qtables:
            _write(cfg, database, f"VACUUM (ANALYZE) {qt};")


# ── Export ───────────────────────────────────────────────────────────────────

def export_rows(cfg, database, table):
    rows = _fetch_all(cfg, database, f"SELECT * FROM {quote_ident(table)}")
    columns = list(rows[0].keys()) if rows else []
    return columns, rows


def export_table_ddl(cfg, database, table) -> str:
    """PostgreSQL has no single-statement DDL dump — reconstruct it from catalog introspection."""
    struct = table_structure(cfg, database, table)
    qt = quote_ident(table)
    col_lines = []
    pk_cols = []
    for c in struct["columns"]:
        line = f"  {quote_ident(c['Field'])} "
        if c["Extra"] == "auto_increment":
            base = c["Type"].split("(")[0].upper()
            line += _SERIAL_MAP.get(base, "SERIAL")
        else:
            line += c["Type"].upper()
            if c["Null"] == "NO":
                line += " NOT NULL"
            if c["Default"] is not None:
                line += f" DEFAULT {c['Default']}"
        col_lines.append(line)
        if c["Key"] == "PRI":
            pk_cols.append(quote_ident(c["Field"]))
    if pk_cols:
        col_lines.append(f"  PRIMARY KEY ({', '.join(pk_cols)})")
    ddl = f"CREATE TABLE {qt} (\n" + ",\n".join(col_lines) + "\n);"

    extra = []
    seen_idx = set()
    for ix in struct["indexes"]:
        key = ix["Key_name"]
        if key == "PRIMARY" or key in seen_idx:
            continue
        seen_idx.add(key)
        cols = [i["Column_name"] for i in struct["indexes"] if i["Key_name"] == key]
        unique = "UNIQUE " if ix["Non_unique"] == 0 else ""
        extra.append(f"CREATE {unique}INDEX {quote_ident(key)} ON {qt} ({', '.join(quote_ident(c) for c in cols)});")
    for fk in struct["foreign_keys"]:
        extra.append(
            f"ALTER TABLE {qt} ADD CONSTRAINT {quote_ident(fk['name'])} FOREIGN KEY "
            f"({', '.join(quote_ident(c) for c in fk['columns'])}) REFERENCES {quote_ident(fk['ref_table'])} "
            f"({', '.join(quote_ident(c) for c in fk['ref_cols'])}) ON UPDATE {fk['on_update']} ON DELETE {fk['on_delete']};"
        )
    if extra:
        ddl += "\n" + "\n".join(extra)
    return ddl


# ── CLI passthrough (for raw .sql import — piping is more robust than parsing) ─

def cli_args(cfg: dict, database: str = None) -> list:
    db = database or cfg.get('database') or 'postgres'
    return ["psql", "-h", str(cfg['host']), "-p", str(cfg['port']), "-U", cfg['user'],
            "-d", db, "-v", "ON_ERROR_STOP=1"]


def cli_env(cfg: dict) -> dict:
    import os
    env = os.environ.copy()
    env["PGPASSWORD"] = cfg.get('password', '')
    return env


def clean_cli_stderr(err: str) -> str:
    return err.strip()

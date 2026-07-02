"""
YourSQL — shared constants for the dialect layer.
Maps a connection's db_type to its dialect family, default port, and required
Python driver package. dialect_mysql.py and dialect_postgres.py implement the
same function interface (list_databases, list_tables, run_query, table_structure,
create_table, alter_table, manage_indexes, manage_foreign_keys, manage_tables,
export_table_ddl, import_sql_stream, etc.) for their respective family.
"""

# db_type -> dialect family ("mysql" or "postgres")
FAMILY = {
    "mysql": "mysql",
    "mariadb": "mysql",
    "postgresql": "postgres",
    "cockroachdb": "postgres",
    "gcloud_postgres": "postgres",
    "greenplum": "postgres",
}

DEFAULT_PORTS = {
    "mysql": 3306,
    "mariadb": 3306,
    "postgresql": 5432,
    "cockroachdb": 26257,
    "gcloud_postgres": 5432,
    "greenplum": 5432,
}

DB_TYPE_LABELS = {
    "mysql": "MySQL",
    "mariadb": "MariaDB",
    "postgresql": "PostgreSQL",
    "cockroachdb": "CockroachDB",
    "gcloud_postgres": "Google Cloud SQL - PostgreSQL",
    "greenplum": "Greenplum",
}

# dialect family -> (importable module name, pip package name)
DRIVERS = {
    "mysql": ("pymysql", "pymysql"),
    "postgres": ("psycopg2", "psycopg2-binary"),
}


def family_of(db_type: str) -> str:
    return FAMILY.get(db_type or "mysql", "mysql")


def default_port(db_type: str) -> int:
    return DEFAULT_PORTS.get(db_type or "mysql", 3306)


def _json_safe_value(v):
    import datetime
    import decimal
    import uuid
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, (datetime.datetime, datetime.date, datetime.time)):
        return v.isoformat()
    if isinstance(v, datetime.timedelta):
        return str(v)
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, (bytes, bytearray)):
        try:
            return v.decode("utf-8")
        except UnicodeDecodeError:
            return v.hex()
    return v


def json_safe_rows(rows):
    """Convert DB-API row dicts (Decimal, datetime, bytes, UUID, ...) into JSON-serializable values."""
    return [{k: _json_safe_value(v) for k, v in row.items()} for row in rows]

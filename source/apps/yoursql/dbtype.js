// YourSQL — shared DB-type metadata (dialect families, labels, per-family type options)
// Mirrors backend/apps/yoursql/dialect_common.py — keep the two in sync.

YS.dbtype = (() => {

  // db_type -> { label, family, port }, same mapping/order as dialect_common.DB_TYPE_LABELS
  var DB_TYPES = [
    { id: 'mysql',            label: 'MySQL',                        family: 'mysql',    port: 3306 },
    { id: 'mariadb',          label: 'MariaDB',                      family: 'mysql',    port: 3306 },
    { id: 'postgresql',       label: 'PostgreSQL',                   family: 'postgres', port: 5432 },
    { id: 'cockroachdb',      label: 'CockroachDB',                  family: 'postgres', port: 26257 },
    { id: 'gcloud_postgres',  label: 'Google Cloud SQL - PostgreSQL', family: 'postgres', port: 5432 },
    { id: 'greenplum',        label: 'Greenplum',                    family: 'postgres', port: 5432 },
  ];

  function familyOf(dbType) {
    var t = DB_TYPES.find(function(d) { return d.id === dbType; });
    return t ? t.family : 'mysql';
  }

  function defaultPort(dbType) {
    var t = DB_TYPES.find(function(d) { return d.id === dbType; });
    return t ? t.port : 3306;
  }

  function labelOf(dbType) {
    var t = DB_TYPES.find(function(d) { return d.id === dbType; });
    return t ? t.label : dbType;
  }

  // Connections carry a db_type field ("sqlite" for builtin mvmApps/Core connections,
  // which isn't in DB_TYPES — familyOf() falls through to "mysql", matching the
  // pre-existing MySQL-shaped structure output those connections already produce).
  function familyForConn(conn) {
    return familyOf(conn && conn.db_type);
  }

  // ── MySQL / MariaDB family type metadata (unchanged from the original app) ──
  var MYSQL_TYPE_GROUPS = {
    'Integer': ['TINYINT','SMALLINT','MEDIUMINT','INT','BIGINT'],
    'Float':   ['FLOAT','DOUBLE','DECIMAL','NUMERIC'],
    'String':  ['CHAR','VARCHAR','TINYTEXT','TEXT','MEDIUMTEXT','LONGTEXT'],
    'Binary':  ['BINARY','VARBINARY','TINYBLOB','BLOB','MEDIUMBLOB','LONGBLOB'],
    'Date':    ['DATE','DATETIME','TIMESTAMP','TIME','YEAR'],
    'Other':   ['BIT','BOOLEAN','JSON','GEOMETRY','ENUM','SET'],
  };

  // ── PostgreSQL family type metadata (mirrors dialect_postgres.py's constants) ──
  var POSTGRES_TYPE_GROUPS = {
    'Integer': ['SMALLINT','INTEGER','BIGINT'],
    'Float':   ['REAL','DOUBLE PRECISION','NUMERIC','DECIMAL'],
    'String':  ['CHAR','VARCHAR','TEXT'],
    'Binary':  ['BYTEA'],
    'Date':    ['DATE','TIME','TIMESTAMP','TIMESTAMPTZ'],
    'Other':   ['BOOLEAN','JSON','JSONB','UUID'],
  };

  var FAMILIES = {
    mysql: {
      typeGroups:        MYSQL_TYPE_GROUPS,
      needsLength:       ['TINYINT','SMALLINT','MEDIUMINT','INT','BIGINT','FLOAT','DOUBLE','DECIMAL','NUMERIC','CHAR','VARCHAR','BINARY','VARBINARY','BIT'],
      needsDecimals:      ['FLOAT','DOUBLE','DECIMAL','NUMERIC'],
      needsEnum:          ['ENUM','SET'],
      canUnsigned:        ['TINYINT','SMALLINT','MEDIUMINT','INT','BIGINT','FLOAT','DOUBLE','DECIMAL','NUMERIC'],
      noDefault:          ['TEXT','TINYTEXT','MEDIUMTEXT','LONGTEXT','BLOB','TINYBLOB','MEDIUMBLOB','LONGBLOB','JSON','GEOMETRY'],
      hasCollation:       ['CHAR','VARCHAR','TINYTEXT','TEXT','MEDIUMTEXT','LONGTEXT','ENUM','SET'],
      autoIncrementTypes: ['TINYINT','SMALLINT','MEDIUMINT','INT','BIGINT'],
      defaultIntType:     'INT',
      defaultStringType:  'VARCHAR',
      hasEngine:          true,
      hasFulltext:        true,
      hasCheckRepair:     true,
      optimizeLabel:      'Optimize',
      optimizeDesc:       'Defragment, reclaim space',
    },
    postgres: {
      typeGroups:        POSTGRES_TYPE_GROUPS,
      needsLength:       ['VARCHAR','CHAR'],
      needsDecimals:      ['NUMERIC','DECIMAL'],
      needsEnum:          [],
      canUnsigned:        [], // PostgreSQL has no UNSIGNED modifier
      noDefault:          ['TEXT','JSON','JSONB','BYTEA'],
      hasCollation:       [], // dialect_postgres.py doesn't apply per-column COLLATE
      autoIncrementTypes: ['SMALLINT','INTEGER','BIGINT'], // SERIAL/BIGSERIAL/SMALLSERIAL-able
      defaultIntType:     'INTEGER',
      defaultStringType:  'VARCHAR',
      hasEngine:          false,
      hasFulltext:        false,
      hasCheckRepair:     false,
      optimizeLabel:      'Vacuum',
      optimizeDesc:       'VACUUM (ANALYZE) — reclaim space, update stats',
    },
  };

  function meta(family) {
    return FAMILIES[family] || FAMILIES.mysql;
  }

  return { DB_TYPES, familyOf, defaultPort, labelOf, familyForConn, meta };
})();

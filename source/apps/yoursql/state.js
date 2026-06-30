// YourSQL — shared state
const YS = window.YS || {};
window.YS = YS;

YS.state = {
  connections: [],
  activeConn: null,
  activeDb: null,
  activeTable: null,
  colMeta: {},       // { colName: { key, baseType, allowNull, autoIncrement, enumValues, ... } }
  page: 1,
  pageSize: 50,
  totalRows: 0,
  filters: [],       // [{ col, op, val }]
  sort: [],          // [{ col, dir }]
  selection: { mode: 'none', pageRows: [] }, // mode: none|page|all
  lastSql: '',
};

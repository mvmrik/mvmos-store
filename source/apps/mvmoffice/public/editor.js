// mvmOffice — the text of a page. ProseMirror with three nodes of our own:
//   table_embed  a table living in the text, drawn by the grid
//   formula      a value inside a sentence, computed from the tables
//   page_break   the next text starts on a new sheet
(function () {
  if (window.MvmOfficeEditor) return;
  const PM = window.MvmPM;
  const M = window.MvmOfficeModel;
  const { Schema, DOMSerializer, Fragment, Slice } = PM.model;
  const { EditorState, Plugin, PluginKey, NodeSelection, TextSelection } = PM.state;
  const { EditorView, Decoration, DecorationSet } = PM.view;
  const cmd = PM.commands;
  const { keymap } = PM.keymap;
  const hist = PM.history;
  const L = PM.schemaList;
  const IR = PM.inputrules;

  // Puts a block (page break, table) where the cursor is and leaves the
  // cursor in the paragraph after it, adding one when there is none —
  // otherwise the next key typed would replace the block that is still
  // selected.
  function withBlock(state, node) {
    const tr = state.tr.replaceSelectionWith(node);
    const pos = tr.selection.to;
    const after = tr.doc.resolve(pos).nodeAfter;
    if (!after || !after.isTextblock) tr.insert(pos, state.schema.nodes.paragraph.create());
    return tr.setSelection(TextSelection.create(tr.doc, pos + 1));
  }

  const alignAttr = { align: { default: null } };
  const alignStyle = a => (a ? { style: 'text-align:' + a } : {});
  const alignOf = dom => {
    const a = dom.style && dom.style.textAlign;
    return ['left', 'center', 'right', 'justify'].includes(a) ? a : null;
  };

  // One schema per document window: embedded tables and text formulas are
  // drawn from that window's document.
  function makeSchema(office) {
    const base = PM.schemaBasic.schema.spec;
    let nodes = base.nodes
      .update('paragraph', {
        content: 'inline*', group: 'block', attrs: alignAttr,
        parseDOM: [{ tag: 'p', getAttrs: dom => ({ align: alignOf(dom) }) }],
        toDOM: n => ['p', alignStyle(n.attrs.align), 0],
      })
      .update('heading', {
        attrs: Object.assign({ level: { default: 1 } }, alignAttr),
        content: 'inline*', group: 'block', defining: true,
        parseDOM: [1, 2, 3, 4, 5, 6].map(level => ({ tag: 'h' + level, getAttrs: dom => ({ level: Math.min(level, 3), align: alignOf(dom) }) })),
        toDOM: n => ['h' + n.attrs.level, alignStyle(n.attrs.align), 0],
      })
      .remove('image')
      .remove('code_block');
    nodes = L.addListNodes(nodes, 'paragraph block*', 'block');
    nodes = nodes.append({
      table_embed: {
        group: 'block', atom: true, selectable: true, draggable: false,
        attrs: { tableId: { default: '' } },
        parseDOM: [{
          tag: 'table',
          getAttrs: dom => {
            const id = dom.getAttribute('data-mo-table');
            if (id) return { tableId: id };
            // A table pasted from a web page, Word or a spreadsheet becomes
            // a table of our own.
            const rows = M.cellsFromHtmlTable(dom);
            if (!rows.length) return false;
            return { tableId: office.tableFromRows(rows).id };
          },
        }],
        toDOM: n => tableDOM(office, office.doc.tables[n.attrs.tableId], n.attrs.tableId),
      },
      formula: {
        group: 'inline', inline: true, atom: true, selectable: true,
        attrs: { expr: { default: '' }, fmt: { default: null } },
        parseDOM: [{
          tag: 'span[data-mo-fx]',
          getAttrs: dom => {
            let fmt = null;
            try { fmt = JSON.parse(dom.getAttribute('data-mo-fmt') || 'null'); } catch (e) { /* plain text */ }
            return { expr: dom.getAttribute('data-mo-fx'), fmt };
          },
        }],
        toDOM: n => ['span', { 'data-mo-fx': n.attrs.expr, 'data-mo-fmt': JSON.stringify(n.attrs.fmt), class: 'mo-fx' }, office.inlineText(n.attrs.expr, n.attrs.fmt)],
      },
      page_break: {
        group: 'block', atom: true, selectable: true,
        parseDOM: [{ tag: 'div.mo-page-break' }],
        toDOM: () => ['div', { class: 'mo-page-break' }],
      },
    });
    const marks = base.marks
      .remove('link')
      .remove('code')
      .append({
        underline: { parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }], toDOM: () => ['u', 0] },
        strike: { parseDOM: [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration=line-through' }], toDOM: () => ['s', 0] },
        color: {
          attrs: { color: {} },
          parseDOM: [{ style: 'color', getAttrs: v => (/^#[0-9a-f]{3,8}$/i.test(v) ? { color: v } : false) }],
          toDOM: m => ['span', { style: 'color:' + m.attrs.color }, 0],
        },
      });
    return new Schema({ nodes, marks });
  }

  // The HTML of a table: what goes to the clipboard and to the printer. The
  // header row is a <thead>, so a table running onto the next sheet repeats it.
  function tableDOM(office, t, id) {
    const table = document.createElement('table');
    table.className = 'mo-print-table';
    table.setAttribute('data-mo-table', id);
    if (!t) return table;
    const eng = office.engine;
    const cg = document.createElement('colgroup');
    for (let c = 0; c < t.cols; c++) {
      const col = document.createElement('col');
      col.style.width = (t.colW[c] || 120) + 'px';
      cg.appendChild(col);
    }
    table.appendChild(cg);
    const row = (r, tag) => {
      const tr = document.createElement('tr');
      for (let c = 0; c < t.cols; c++) {
        const td = document.createElement(tag);
        const cell = t.cells[r + ',' + c];
        td.textContent = eng.display(t, r, c);
        const v = eng.value(t, r, c);
        const a = (cell && cell.a) || (typeof v === 'number' ? 'right' : null);
        let st = a ? 'text-align:' + a + ';' : '';
        if (cell) {
          if (cell.b) st += 'font-weight:700;';
          if (cell.i) st += 'font-style:italic;';
          if (cell.u || cell.s) st += 'text-decoration:' + (cell.u ? 'underline ' : '') + (cell.s ? 'line-through' : '') + ';';
          if (cell.bg) st += 'background:' + cell.bg + ';';
          if (cell.fg) st += 'color:' + cell.fg + ';';
        }
        if (st) td.setAttribute('style', st);
        tr.appendChild(td);
      }
      return tr;
    };
    let start = 0;
    if (t.header && t.rows > 1) {
      const thead = document.createElement('thead');
      thead.appendChild(row(0, 'th'));
      table.appendChild(thead);
      start = 1;
    }
    const tbody = document.createElement('tbody');
    for (let r = start; r < t.rows; r++) tbody.appendChild(row(r, 'td'));
    table.appendChild(tbody);
    return table;
  }

  // ── Node views ───────────────────────────────────────────────────────────
  class EmbedView {
    constructor(node, view, getPos, ed) {
      this.node = node;
      this.ed = ed;
      this.getPos = getPos;
      this.dom = document.createElement('div');
      this.dom.className = 'mo-embed';
      this.dom.contentEditable = 'false';
      this.mount();
      ed.embeds.add(this);
    }
    mount() {
      const office = this.ed.office;
      const t = office.doc.tables[this.node.attrs.tableId];
      this.dom.innerHTML = '';
      this.grid = null;
      if (!t) {
        this.dom.innerHTML = '<div class="mo-embed-missing">' + office.t('mo_table_missing') + '</div>';
        return;
      }
      this.grid = new window.MvmOfficeGrid.Grid(this.dom, { office, table: t, mode: 'embed' });
      this.grid.getPos = this.getPos;
      this.grid.editorView = this.ed.view;
    }
    update(node) {
      if (node.type !== this.node.type || node.attrs.tableId !== this.node.attrs.tableId) return false;
      this.node = node;
      return true;
    }
    refresh() {
      const office = this.ed.office;
      const t = office.doc.tables[this.node.attrs.tableId];
      if (!this.grid || this.grid.table !== t) this.mount();
      else this.grid.render();
    }
    selectNode() { this.dom.classList.add('mo-embed-sel'); }
    deselectNode() { this.dom.classList.remove('mo-embed-sel'); }
    stopEvent() { return true; }
    ignoreMutation() { return true; }
    destroy() {
      this.ed.embeds.delete(this);
      if (this.grid) this.grid.destroy();
    }
  }

  class FormulaView {
    constructor(node, view, getPos, ed) {
      this.node = node;
      this.ed = ed;
      this.getPos = getPos;
      this.dom = document.createElement('span');
      this.dom.className = 'mo-fx';
      this.dom.contentEditable = 'false';
      this.dom.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        this.ed.editFormulaAt(this.getPos());
      });
      this.refresh();
      ed.formulas.add(this);
    }
    update(node) {
      if (node.type !== this.node.type) return false;
      this.node = node;
      this.refresh();
      return true;
    }
    refresh() {
      const office = this.ed.office;
      const text = office.inlineText(this.node.attrs.expr, this.node.attrs.fmt);
      this.dom.textContent = text === '' ? ' ' : text;
      this.dom.title = '=' + this.node.attrs.expr;
      this.dom.classList.toggle('mo-err', office.inlineIsError(this.node.attrs.expr));
    }
    selectNode() { this.dom.classList.add('mo-fx-sel'); }
    deselectNode() { this.dom.classList.remove('mo-fx-sel'); }
    stopEvent(e) { return e.type === 'mousedown'; }
    ignoreMutation() { return true; }
    destroy() { this.ed.formulas.delete(this); }
  }

  // ── Sheets on screen ─────────────────────────────────────────────────────
  // The text is one flowing column. It is shown on separate sheets the way
  // print lays it out: a block that would cross the bottom margin moves to
  // the next sheet behind an invisible spacer, a page break starts a new
  // sheet, and a list moves item by item. A block taller than a whole sheet
  // stays where it starts.
  const PX = 96 / 25.4;
  const SHEET_GAP = 18;
  const pagerKey = new PluginKey('moPager');
  function pagerPlugin(ed) {
    return new Plugin({
      key: pagerKey,
      state: {
        init: () => DecorationSet.empty,
        apply: (tr, set) => {
          const next = tr.getMeta(pagerKey);
          return next !== undefined ? next : set.map(tr.mapping, tr.doc);
        },
      },
      props: { decorations: state => pagerKey.getState(state) },
      view: () => ({ update: () => ed.repaginate() }),
    });
  }
  function gapDOM() {
    const el = document.createElement('div');
    el.className = 'mo-pgap';
    el.contentEditable = 'false';
    return el;
  }

  // ── The editor ───────────────────────────────────────────────────────────
  class PageEditor {
    constructor(office, host, page) {
      this.office = office;
      this.page = page;
      this.schema = office.schema;
      this.embeds = new Set();
      this.formulas = new Set();
      const s = this.schema;

      let content;
      try { content = s.nodeFromJSON(page.content); } catch (e) { content = s.nodeFromJSON(M.emptyPageContent()); }

      const rules = [
        IR.textblockTypeInputRule(/^(#{1,3})\s$/, s.nodes.heading, m => ({ level: m[1].length })),
        IR.wrappingInputRule(/^\s*([-+*])\s$/, s.nodes.bullet_list),
        IR.wrappingInputRule(/^(\d+)\.\s$/, s.nodes.ordered_list, m => ({ order: +m[1] }), (m, n) => n.childCount + n.attrs.order === +m[1]),
        IR.wrappingInputRule(/^\s*>\s$/, s.nodes.blockquote),
        // "{=" opens the formula box right where the value will go.
        new IR.InputRule(/\{=$/, (state, match, start, end) => {
          setTimeout(() => this.insertFormula(), 0);
          return state.tr.delete(start, end - 1);
        }),
      ];

      const mod = {
        'Mod-z': hist.undo, 'Mod-y': hist.redo, 'Mod-Shift-z': hist.redo,
        'Mod-b': cmd.toggleMark(s.marks.strong), 'Mod-i': cmd.toggleMark(s.marks.em),
        'Mod-u': cmd.toggleMark(s.marks.underline),
        'Shift-Enter': cmd.chainCommands(cmd.exitCode, (state, dispatch) => {
          if (dispatch) dispatch(state.tr.replaceSelectionWith(s.nodes.hard_break.create()).scrollIntoView());
          return true;
        }),
        'Mod-Enter': (state, dispatch) => {
          if (dispatch) dispatch(withBlock(state, s.nodes.page_break.create()).scrollIntoView());
          return true;
        },
        'Enter': L.splitListItem(s.nodes.list_item),
        'Tab': L.sinkListItem(s.nodes.list_item),
        'Shift-Tab': L.liftListItem(s.nodes.list_item),
      };

      const self = this;
      const state = EditorState.create({
        doc: content,
        plugins: [
          IR.inputRules({ rules }),
          keymap(mod),
          keymap(cmd.baseKeymap),
          hist.history(),
          PM.dropcursor.dropCursor({ color: 'var(--mo-accent)' }),
          PM.gapcursor.gapCursor(),
          pagerPlugin(this),
          new Plugin({
            props: {
              transformPasted: slice => self.pastedTables(slice),
              handleDOMEvents: {
                focus: () => { office.activate(null); office.onTextFocus(self); return false; },
              },
            },
          }),
        ],
      });

      this.view = new EditorView(host, {
        state,
        nodeViews: {
          table_embed: (n, v, g) => new EmbedView(n, v, g, this),
          formula: (n, v, g) => new FormulaView(n, v, g, this),
        },
        dispatchTransaction: tr => {
          const next = this.view.state.apply(tr);
          this.view.updateState(next);
          if (tr.docChanged) {
            this.page.content = next.doc.toJSON();
            office.textChanged(this);
          }
          if (tr.docChanged || tr.selectionSet || tr.getMeta(pagerKey) === undefined) office.onTextSelection(this);
        },
        attributes: { class: 'mo-text', spellcheck: 'true' },
      });
      // Tables and fonts change height on their own; the sheets follow.
      this._ro = new ResizeObserver(() => this.repaginate());
      this._ro.observe(this.view.dom);
      this.repaginate();
    }

    destroy() {
      this._ro.disconnect();
      cancelAnimationFrame(this._pgRaf);
      this.view.destroy();
    }

    repaginate() {
      if (this._pgRaf) return;
      this._pgRaf = requestAnimationFrame(() => { this._pgRaf = 0; this.layoutSheets(); });
    }

    layoutSheets() {
      const view = this.view;
      const paper = view.dom.closest('.mo-paper');
      if (!paper || !view.dom.isConnected) return;
      let layer = paper.querySelector(':scope > .mo-sheets');
      if (!layer) {
        layer = document.createElement('div');
        layer.className = 'mo-sheets';
        paper.prepend(layer);
      }
      const setGaps = set => view.dispatch(view.state.tr.setMeta(pagerKey, set).setMeta('addToHistory', false));
      // The narrow view has no sheets: the text simply fills the window.
      if (view.dom.closest('.mo-narrow')) {
        if (pagerKey.getState(view.state).find().length) setGaps(DecorationSet.empty);
        layer.textContent = '';
        paper.style.minHeight = '';
        return;
      }
      const box = M.pageBox(this.office.doc);
      const PH = box.h * PX, T = box.t * PX, B = box.b * PX, STEP = PH + SHEET_GAP;
      const desk = paper.parentElement, scroll = desk.scrollTop;

      // Where every block would be without any spacers.
      view.dom.classList.add('mo-measuring');
      const base = paper.getBoundingClientRect().top;
      const units = [];
      let brk = false;
      const add = (node, pos) => {
        const dom = view.nodeDOM(pos);
        if (dom && dom.nodeType === 1) {
          const r = dom.getBoundingClientRect();
          units.push({ pos, top: r.top - base, bottom: r.bottom - base, forced: brk });
        }
        brk = node.type.name === 'page_break';
      };
      view.state.doc.forEach((node, off) => {
        if (node.type.name === 'bullet_list' || node.type.name === 'ordered_list') node.forEach((item, o) => add(item, off + 1 + o));
        else add(node, off);
      });
      view.dom.classList.remove('mo-measuring');
      desk.scrollTop = scroll;

      // Walk down the sheets, moving what does not fit.
      const moves = [];
      let shift = 0, lastPage = 0, bottomMost = T;
      units.forEach((u, i) => {
        let top = u.top + shift;
        const height = u.bottom - u.top;
        const p = Math.floor(top / STEP);
        const atTop = top <= p * STEP + T + 24;
        let target = null;
        if (u.forced && i > 0 && !atTop) target = (Math.max(p, lastPage) + 1) * STEP + T;
        else if (top > p * STEP + PH - B) target = (p + 1) * STEP + T;
        else if (top + height > p * STEP + PH - B + 0.5 && !(atTop && height > PH - T - B)) target = (p + 1) * STEP + T;
        if (target !== null && i > 0) {
          const delta = target - top;
          moves.push({ pos: u.pos, delta, target });
          shift += delta;
          top = target;
        }
        lastPage = Math.floor(top / STEP);
        bottomMost = Math.max(bottomMost, top + height);
      });

      const same = (a, b) => a.length === b.length && a.every((d, i) => d.from === b[i].pos && Math.abs(d.spec.delta - b[i].delta) < 0.5);
      if (!same(pagerKey.getState(view.state).find(), moves)) {
        setGaps(DecorationSet.create(view.state.doc, moves.map(m =>
          Decoration.widget(m.pos, gapDOM, { side: -1, ignoreSelection: true, key: `pg${m.pos}:${Math.round(m.delta)}`, delta: m.delta }))));
      }
      // A spacer changes how the margins around it add up; measure each
      // moved block where it really landed and correct its spacer.
      const gaps = view.dom.querySelectorAll('.mo-pgap');
      moves.forEach((m, i) => {
        const gap = gaps[i], dom = view.nodeDOM(m.pos);
        if (!gap || !dom) return;
        if (!gap.style.height) gap.style.height = m.delta + 'px';
        const err = dom.getBoundingClientRect().top - paper.getBoundingClientRect().top - m.target;
        if (Math.abs(err) > 0.5) gap.style.height = Math.max(0, parseFloat(gap.style.height) - err) + 'px';
      });

      const count = Math.max(1, Math.ceil((bottomMost + B - PH) / STEP) + 1);
      if (layer.childElementCount !== count || layer.dataset.step !== String(STEP)) {
        layer.dataset.step = String(STEP);
        layer.textContent = '';
        for (let k = 0; k < count; k++) {
          const sheet = document.createElement('div');
          sheet.className = 'mo-sheet';
          sheet.style.top = k * STEP + 'px';
          sheet.style.height = PH + 'px';
          layer.appendChild(sheet);
        }
      }
      paper.style.minHeight = (count * STEP - SHEET_GAP) + 'px';
      desk.scrollTop = scroll;
    }
    focus() { this.view.focus(); }
    get state() { return this.view.state; }
    run(command) { command(this.view.state, this.view.dispatch, this.view); this.view.focus(); }

    // Values changed somewhere: redraw every value and table on this page.
    refresh() {
      this.formulas.forEach(f => f.refresh());
      this.embeds.forEach(e => e.refresh());
    }

    // ── Pasting tables ─────────────────────────────────────────────────────
    // Our own tables come back by id. A table still shown elsewhere in the
    // document (copy and paste) gets a copy of its data under a new name;
    // one that was cut keeps its data and name.
    pastedTables(slice) {
      const office = this.office;
      const inUse = office.tableIdsInText(this);
      const seen = new Set();
      const map = frag => {
        const out = [];
        frag.forEach(node => {
          if (node.type.name === 'table_embed') {
            const id = node.attrs.tableId;
            const t = office.doc.tables[id];
            if (!t) return;
            if (inUse.has(id) || seen.has(id)) {
              out.push(node.type.create({ tableId: office.copyTable(t).id }));
              return;
            }
            seen.add(id);
            out.push(node);
            return;
          }
          out.push(node.copy(map(node.content)));
        });
        return Fragment.fromArray(out);
      };
      return new Slice(map(slice.content), slice.openStart, slice.openEnd);
    }

    // ── Commands for the toolbar ───────────────────────────────────────────
    markActive(name) {
      const { from, $from, to, empty } = this.state.selection;
      const type = this.schema.marks[name];
      if (empty) return !!type.isInSet(this.state.storedMarks || $from.marks());
      return this.state.doc.rangeHasMark(from, to, type);
    }
    toggleMark(name) { this.run(cmd.toggleMark(this.schema.marks[name])); }
    setColor(color) {
      const type = this.schema.marks.color;
      this.run((state, dispatch) => {
        const { from, to, empty } = state.selection;
        if (empty) {
          if (dispatch) dispatch(color ? state.tr.addStoredMark(type.create({ color })) : state.tr.removeStoredMark(type));
          return true;
        }
        let tr = state.tr.removeMark(from, to, type);
        if (color) tr = tr.addMark(from, to, type.create({ color }));
        if (dispatch) dispatch(tr);
        return true;
      });
    }
    blockType() {
      const { $from } = this.state.selection;
      const n = $from.parent;
      if (n.type.name === 'heading') return 'h' + n.attrs.level;
      return 'p';
    }
    setBlock(kind) {
      const s = this.schema;
      if (kind === 'p') this.run(cmd.setBlockType(s.nodes.paragraph));
      else this.run(cmd.setBlockType(s.nodes.heading, { level: +kind.slice(1) }));
    }
    align() {
      const n = this.state.selection.$from.parent;
      return n.attrs && n.attrs.align || 'left';
    }
    setAlign(align) {
      this.run((state, dispatch) => {
        const { from, to } = state.selection;
        const tr = state.tr;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name === 'paragraph' || node.type.name === 'heading') {
            tr.setNodeMarkup(pos, null, Object.assign({}, node.attrs, { align: align === 'left' ? null : align }));
          }
        });
        if (dispatch) dispatch(tr);
        return true;
      });
    }
    inList(kind) {
      const { $from } = this.state.selection;
      for (let d = $from.depth; d > 0; d--) {
        const n = $from.node(d).type.name;
        if (n === 'bullet_list' || n === 'ordered_list') return n === kind;
      }
      return false;
    }
    toggleList(kind) {
      const s = this.schema;
      if (this.inList(kind)) this.run(L.liftListItem(s.nodes.list_item));
      else this.run(L.wrapInList(s.nodes[kind]));
    }
    undo() { this.run(hist.undo); }
    redo() { this.run(hist.redo); }
    insertBlock(node) {
      this.run((state, dispatch) => {
        if (dispatch) dispatch(withBlock(state, node).scrollIntoView());
        return true;
      });
    }
    insertTable(table) {
      this.insertBlock(this.schema.nodes.table_embed.create({ tableId: table.id }));
      // Straight into the first cell.
      setTimeout(() => {
        for (const e of this.embeds) {
          if (e.node.attrs.tableId === table.id && e.grid) { e.grid.focus(); e.grid.select(0, 0, false); break; }
        }
      }, 0);
    }
    insertPageBreak() { this.insertBlock(this.schema.nodes.page_break.create()); }
    insertRule() { this.insertBlock(this.schema.nodes.horizontal_rule.create()); }

    // ── Formulas in the text ───────────────────────────────────────────────
    insertFormula() {
      const view = this.view;
      const { from } = view.state.selection;
      const rect = view.coordsAtPos(from);
      this.office.formulaBox({
        expr: '', fmt: null, rect,
        onDone: (expr, fmt) => {
          const node = this.schema.nodes.formula.create({ expr, fmt });
          const tr = view.state.tr.replaceSelectionWith(node, false);
          view.dispatch(tr.scrollIntoView());
          view.focus();
        },
        onCancel: () => view.focus(),
      });
    }
    editFormulaAt(pos) {
      const view = this.view;
      const node = view.state.doc.nodeAt(pos);
      if (!node || node.type.name !== 'formula') return;
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
      const dom = view.nodeDOM(pos);
      const rect = dom && dom.getBoundingClientRect ? dom.getBoundingClientRect() : view.coordsAtPos(pos);
      this.office.formulaBox({
        expr: node.attrs.expr, fmt: node.attrs.fmt, rect, editing: true,
        onDone: (expr, fmt) => {
          const cur = view.state.doc.nodeAt(pos);
          if (!cur || cur.type.name !== 'formula') return;
          view.dispatch(view.state.tr.setNodeMarkup(pos, null, { expr, fmt }));
          view.focus();
        },
        onRemove: () => {
          const cur = view.state.doc.nodeAt(pos);
          if (cur && cur.type.name === 'formula') view.dispatch(view.state.tr.delete(pos, pos + cur.nodeSize));
          view.focus();
        },
        onCancel: () => view.focus(),
      });
    }

    // Formulas in this page rewritten by a rename or an insert/delete. Not
    // an undo step of the text: the change that caused it undoes it.
    rewriteFormulas(fn) {
      const view = this.view;
      const tr = view.state.tr;
      view.state.doc.descendants((node, pos) => {
        if (node.type.name !== 'formula') return;
        const out = fn(node.attrs.expr, null);
        if (out !== undefined && out !== node.attrs.expr) tr.setNodeMarkup(pos, null, Object.assign({}, node.attrs, { expr: out }));
      });
      if (tr.docChanged) view.dispatch(tr.setMeta('addToHistory', false));
    }
    formulaExprs() {
      const out = [];
      this.view.state.doc.descendants(n => { if (n.type.name === 'formula') out.push(n.attrs.expr); });
      return out;
    }
    setFormulaExprs(list) {
      const view = this.view;
      const tr = view.state.tr;
      let i = 0;
      view.state.doc.descendants((node, pos) => {
        if (node.type.name !== 'formula') return;
        const want = list[i++];
        if (want != null && want !== node.attrs.expr) tr.setNodeMarkup(pos, null, Object.assign({}, node.attrs, { expr: want }));
      });
      if (tr.docChanged) view.dispatch(tr.setMeta('addToHistory', false));
    }

    // Remove an embedded table from the text (its data stays until the
    // document is next opened, so undo can bring it back).
    removeEmbed(grid) {
      const view = this.view;
      let at = null;
      view.state.doc.descendants((node, pos) => {
        if (at == null && node.type.name === 'table_embed' && node.attrs.tableId === grid.table.id) at = pos;
      });
      if (at == null) return;
      const node = view.state.doc.nodeAt(at);
      view.dispatch(view.state.tr.delete(at, at + node.nodeSize));
      view.focus();
    }
    // Put the text cursor right after an embedded table.
    leaveEmbed(grid) {
      const view = this.view;
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'table_embed' && node.attrs.tableId === grid.table.id) {
          const after = pos + node.nodeSize;
          const $p = view.state.doc.resolve(after);
          const sel = $p.nodeAfter && $p.nodeAfter.isTextblock ? TextSelection.create(view.state.doc, after + 1) : NodeSelection.create(view.state.doc, pos);
          view.dispatch(view.state.tr.setSelection(sel));
        }
      });
      view.focus();
    }
  }

  // The HTML of a page for printing.
  function pageHTML(office, content) {
    const schema = office.schema;
    const node = schema.nodeFromJSON(content);
    const frag = DOMSerializer.fromSchema(schema).serializeFragment(node.content);
    const div = document.createElement('div');
    div.appendChild(frag);
    return div.innerHTML;
  }

  window.MvmOfficeEditor = { makeSchema, PageEditor, pageHTML, tableDOM };
})();

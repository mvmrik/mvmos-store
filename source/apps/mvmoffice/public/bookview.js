// mvmOffice — the book as an object: closed with its front cover, it opens
// on the screen and its leaves turn, so the author can look through the
// pages exactly as they will be printed — the margins, the numbers, the
// running headers, the empty spaces — and go back to change what does not
// look right.
//
// The sheets are the ones the print preview lays out. Two pages are shown
// side by side on a wide screen and one at a time on a narrow one, and the
// leaves near the open place are drawn, so a long book stays light.
(function () {
  'use strict';
  if (window.MvmOfficeBookView) return;
  const PX = 96 / 25.4;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  // o: { t, front, back, pages: [html], css, w, h (mm), title, onClose }
  function open(root, o) {
    const t = o.t;
    const pw = Math.round(o.w * PX), ph = Math.round(o.h * PX);
    // The faces in the order they are met: the cover, the inside of it, the
    // pages, the inside of the back cover, the back cover. Two to a leaf.
    const faces = [{ k: 'img', src: o.front }, { k: 'paper' }];
    o.pages.forEach((h, n) => faces.push({ k: 'page', html: h, n: n + 1 }));
    if (faces.length % 2) faces.push({ k: 'paper' });
    faces.push({ k: 'paper' }, { k: 'img', src: o.back });

    const ov = document.createElement('div');
    ov.className = 'mo-bk';
    ov.innerHTML = `
      <div class="mo-bk-bar">
        <strong>${esc(t('mo_book_preview'))}</strong><span class="mo-bk-title">${esc(o.title || '')}</span><span class="mo-grow"></span>
        <button class="mo-btn mo-primary" data-b="close">${esc(t('mo_close'))}</button>
      </div>
      <div class="mo-bk-stage"><div class="mo-bk-scale"><div class="mo-bk-book"></div></div></div>
      <div class="mo-bk-ctl">
        <button class="mo-ib" data-b="first" title="${esc(t('mo_bk_first'))}">⏮</button>
        <button class="mo-ib" data-b="prev" title="${esc(t('mo_bk_prev'))}">◀</button>
        <button class="mo-ib" data-b="play" title="${esc(t('mo_bk_play'))}">▶</button>
        <button class="mo-ib" data-b="next" title="${esc(t('mo_bk_next'))}">▶▶</button>
        <button class="mo-ib" data-b="last" title="${esc(t('mo_bk_last'))}">⏭</button>
        <span class="mo-bk-label"></span>
      </div>`;
    root.appendChild(ov);
    const stage = ov.querySelector('.mo-bk-stage'), scaleEl = ov.querySelector('.mo-bk-scale'), book = ov.querySelector('.mo-bk-book');
    const label = ov.querySelector('.mo-bk-label'), playBtn = ov.querySelector('[data-b="play"]');

    let mode = 'spread', leaves = [], L = 0, i = 0, timer = null, built = new Set(), zTimer = null, F = faces;

    // The sheets' styles were written for a whole page; inside a face the
    // page's own element plays the part of <body>.
    const css = o.css.replace(/html, body/g, '.pv-root').replace(/(^|[\s,}])body(?=\s*[,{])/g, '$1.pv-root');
    const faceEl = f => {
      const d = document.createElement('div');
      d.className = 'mo-bk-face';
      if (!f || f.k === 'paper') { d.classList.add('mo-bk-paper'); return d; }
      if (f.k === 'img') { d.innerHTML = `<img src="${f.src}" alt="" draggable="false">`; return d; }
      const sh = d.attachShadow({ mode: 'open' });
      sh.innerHTML = `<style>${css}
        .pv-root{background:none!important;padding:0!important;margin:0!important;width:${pw}px;height:${ph}px;overflow:hidden}
        .pv-page{margin:0!important;box-shadow:none!important;break-after:auto!important}</style><div class="pv-root">${f.html}</div>`;
      return d;
    };

    function rebuild() {
      mode = stage.clientWidth / Math.max(1, stage.clientHeight) > 1.1 ? 'spread' : 'single';
      // One page at a time has no use for the blank insides of the covers.
      F = mode === 'spread' ? faces : faces.filter(f => f.k !== 'paper');
      book.textContent = ''; built = new Set(); leaves = [];
      const per = mode === 'spread' ? 2 : 1;
      L = Math.ceil(F.length / per);
      book.style.width = (mode === 'spread' ? pw * 2 : pw) + 'px';
      book.style.height = ph + 'px';
      for (let j = 0; j < L; j++) {
        const leaf = document.createElement('div');
        leaf.className = 'mo-bk-leaf';
        leaf.style.width = pw + 'px'; leaf.style.height = ph + 'px';
        leaf.style.left = (mode === 'spread' ? pw : 0) + 'px';
        book.appendChild(leaf);
        leaves.push(leaf);
      }
      const stackL = document.createElement('div'), stackR = document.createElement('div');
      stackL.className = 'mo-bk-stack mo-bk-stack-l'; stackR.className = 'mo-bk-stack mo-bk-stack-r';
      stackL.style.height = stackR.style.height = ph - 6 + 'px';
      book.prepend(stackL); book.append(stackR);
      book._stacks = [stackL, stackR];
      i = Math.max(0, Math.min(L, i));
      fitScale();
      layout(false);
    }
    function fitScale() {
      const W = stage.clientWidth, H = stage.clientHeight;
      const bw = mode === 'spread' ? pw * 2 : pw;
      const s = Math.min((W * 0.94) / bw, (H * 0.9) / ph);
      scaleEl.style.transform = `scale(${s})`;
      scaleEl.style.width = bw + 'px'; scaleEl.style.height = ph + 'px';
    }
    function ensure() {
      const per = mode === 'spread' ? 2 : 1;
      for (let j = Math.max(0, i - 3); j <= Math.min(L - 1, i + 3); j++) {
        if (built.has(j)) continue;
        built.add(j);
        const front = faceEl(F[j * per]);
        front.classList.add('mo-bk-front', mode === 'spread' ? 'mo-bk-r' : 'mo-bk-s');
        leaves[j].appendChild(front);
        if (mode === 'spread') {
          const back = faceEl(F[j * per + 1]);
          back.classList.add('mo-bk-back', 'mo-bk-l');
          leaves[j].appendChild(back);
        }
      }
    }
    function layout(animate, flipping) {
      ensure();
      leaves.forEach((leaf, j) => {
        leaf.style.transition = animate ? '' : 'none';
        const flipped = j < i;
        leaf.style.transform = `rotateY(${flipped ? -180 : 0}deg)`;
        leaf.style.zIndex = flipping === j ? L + 2 : flipped ? j + 1 : L - j;
        leaf.style.pointerEvents = 'none';
        leaf.classList.toggle('mo-bk-gone', mode === 'single' && flipped && j < i - 1);
      });
      // A closed book sits on one side of the spine, as it does on a table.
      const shift = mode === 'spread' ? (i === 0 ? -pw / 2 : i === L ? pw / 2 : 0) : 0;
      book.style.transition = animate ? '' : 'none';
      book.style.transform = `translateX(${shift}px)`;
      const max = Math.min(22, Math.max(4, L * 0.7));
      const [sl, sr] = book._stacks;
      const left = mode === 'spread' ? (i / L) * max : 0, right = ((L - i) / L) * max;
      sl.style.width = left + 'px'; sl.style.left = (pw - left) + 'px'; sl.style.display = mode === 'spread' && i > 0 ? '' : 'none';
      sr.style.width = right + 'px'; sr.style.left = (mode === 'spread' ? pw * 2 : pw) + 'px'; sr.style.display = i < L ? '' : 'none';
      const per = mode === 'spread' ? 2 : 1;
      const faceNo = idx => { const f = F[idx]; return f && f.k === 'page' ? f.n : null; };
      const a = mode === 'spread' ? faceNo(i * 2 - 1) : null, b = faceNo(i * per);
      const pages = o.pages.length;
      label.textContent = i === 0 ? t('mo_front_cover') : i === L ? t('mo_back_cover')
        : mode === 'spread' ? (a && b ? `${a}–${b}` : (a || b || '')) + ' / ' + pages : (b || '') + ' / ' + pages;
      ov.querySelector('[data-b="prev"]').disabled = ov.querySelector('[data-b="first"]').disabled = i === 0;
      ov.querySelector('[data-b="next"]').disabled = ov.querySelector('[data-b="last"]').disabled = i === L;
    }
    function go(n, animate) {
      n = Math.max(0, Math.min(L, n));
      if (n === i) { stop(); return; }
      // Several leaves turn one after another, so a jump looks like riffling the pages.
      const step = n > i ? 1 : -1;
      const run = () => {
        const flipping = step > 0 ? i : i - 1;
        i += step;
        layout(animate !== false, flipping);
        if (i !== n) setTimeout(run, Math.abs(n - i) > 6 ? 40 : 160);
      };
      run();
    }
    function play() {
      if (timer) { stop(); return; }
      if (i === L) go(0, false);
      playBtn.textContent = '❚❚';
      timer = setInterval(() => { if (i >= L) { stop(); return; } go(i + 1); }, 1400);
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } playBtn.textContent = '▶'; }
    const step = d => { stop(); go(i + d * 1); };
    const close = () => {
      stop(); clearTimeout(zTimer);
      document.removeEventListener('keydown', key, true);
      ro.disconnect(); ov.remove();
      if (o.onClose) o.onClose();
    };
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); step(-1); }
      else if (e.key === 'Home') { e.preventDefault(); stop(); go(0); }
      else if (e.key === 'End') { e.preventDefault(); stop(); go(L); }
      else if (e.key === ' ') { e.preventDefault(); play(); }
    };
    document.addEventListener('keydown', key, true);

    ov.addEventListener('click', e => {
      const b = e.target.closest('[data-b]');
      if (b) {
        const a = b.dataset.b;
        if (a === 'close') close(); else if (a === 'prev') step(-1); else if (a === 'next') step(1);
        else if (a === 'first') { stop(); go(0); } else if (a === 'last') { stop(); go(L); } else if (a === 'play') play();
      }
    });
    // A click on the left or right half of the book turns a leaf; so does a swipe.
    let down = null;
    stage.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
    stage.addEventListener('pointerup', e => {
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      down = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { step(dx < 0 ? 1 : -1); return; }
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
        const r = scaleEl.getBoundingClientRect();
        step(e.clientX < r.left + r.width / 2 ? -1 : 1);
      }
    });
    const ro = new ResizeObserver(() => {
      const next = stage.clientWidth / Math.max(1, stage.clientHeight) > 1.1 ? 'spread' : 'single';
      if (next !== mode) {
        // Keep the place: the face that was on the right (or the one shown) stays.
        const face = F[i * (mode === 'spread' ? 2 : 1)];
        const list = next === 'spread' ? faces : faces.filter(f => f.k !== 'paper');
        const at = Math.max(0, list.indexOf(face));
        i = next === 'spread' ? Math.floor(at / 2) : at;
        rebuild();
      } else fitScale();
    });
    ro.observe(stage);
    rebuild();
    // It opens by itself, so the first thing seen is the book opening.
    setTimeout(() => { if (i === 0) go(1); }, 500);
    return { close };
  }

  window.MvmOfficeBookView = { open };
})();

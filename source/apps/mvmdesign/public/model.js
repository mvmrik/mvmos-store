(function () {
  'use strict';
  const uid = () => crypto.randomUUID();
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, +v || 0));
  const color = (v, fallback = '#ffffff') =>
    /^#[\da-f]{6}$/i.test(v) ? v : fallback;
  const animations = [
    'none',
    'fade',
    'left',
    'right',
    'up',
    'down',
    'zoom',
    'typewriter',
    'words',
    'zoomLarge',
    'pop',
    'bounce',
    'elastic',
    'rotate',
    'spin',
    'flipX',
    'flipY',
    'diagonalLeft',
    'diagonalRight',
    'wipeLeft',
    'wipeRight',
    'wipeUp',
    'wipeDown',
    'blur',
    'stretchX',
    'stretchY',
  ];
  const textEffects = [
    'none',
    'hollow',
    'splice',
    'echo',
    'glitch',
    'neon',
    'extrude',
    'retro',
    'metal',
    'double',
    'emboss',
    'striped',
    'chromatic',
  ];
  const styleBase = {
    effect: 'none',
    effectAmount: 0.6,
    color: '#ffffff',
    color2: '#ffbc66',
    gradient: false,
    stroke: '#131b2f',
    strokeWidth: 0,
    shadow: 0,
    shadowColor: '#000000',
    panel: false,
    panelColor: '#131b2f',
    panelOpacity: 0.8,
  };
  const styleVariants = {
    plain: {},
    outline: { strokeWidth: 7 },
    glow: { shadow: 35, shadowColor: '#ad73ff' },
    gold: {
      effect: 'metal',
      color: '#fff1bb',
      color2: '#ad5c13',
      stroke: '#7c4714',
      strokeWidth: 2,
    },
    box: { panel: true },
    neon: { effect: 'neon', color: '#fff1fc', color2: '#ff38b8' },
    hollow: { effect: 'hollow', color: '#c4eaff', strokeWidth: 3 },
    splice: {
      effect: 'splice',
      color: '#ffe069',
      color2: '#f65083',
      strokeWidth: 3,
    },
    echo: { effect: 'echo', color: '#fff6df', color2: '#bf83ff' },
    glitch: { effect: 'glitch', color: '#ffffff', color2: '#16e6e0' },
    extrude: {
      effect: 'extrude',
      color: '#ffe4a6',
      color2: '#9b4927',
      strokeWidth: 1,
    },
    retro: { effect: 'retro', color: '#ffedb6', color2: '#e56f4b' },
    chrome: {
      effect: 'metal',
      color: '#edf7ff',
      color2: '#465d84',
      stroke: '#5b708a',
      strokeWidth: 2,
    },
    silver: { effect: 'metal', color: '#ffffff', color2: '#6a798a' },
    fire: {
      gradient: true,
      color: '#fff5a1',
      color2: '#f14a32',
      shadow: 14,
      shadowColor: '#f57229',
    },
    ice: {
      gradient: true,
      color: '#ffffff',
      effect: 'double',
      stroke: '#1d4f91',
      color2: '#6bc8ff',
      strokeWidth: 3,
    },
    ocean: {
      gradient: true,
      color: '#9effdd',
      color2: '#3399ee',
      effect: 'extrude',
    },
    sunset: {
      gradient: true,
      color: '#fff09c',
      color2: '#ed609b',
      effect: 'echo',
    },
    candy: {
      effect: 'double',
      color: '#ffb6e5',
      color2: '#a84487',
      stroke: '#fff0fa',
      strokeWidth: 6,
    },
    comic: {
      effect: 'extrude',
      color: '#ffe65d',
      color2: '#261d51',
      stroke: '#261d51',
      strokeWidth: 7,
    },
    sticker: {
      effect: 'double',
      color: '#8369e8',
      color2: '#39256d',
      stroke: '#ffffff',
      strokeWidth: 10,
    },
    embossed: { effect: 'emboss', color: '#bdc9df', color2: '#425477' },
    striped: { effect: 'striped', color: '#ffdf7a', color2: '#d25277' },
    chromatic: { effect: 'chromatic', color: '#fff5e6', color2: '#47d8cf' },
  };
  const textStyles = Object.keys(styleVariants);
  const textPreset = (key) => ({
    ...styleBase,
    ...(styleVariants[key] || {}),
    textStyle: textStyles.includes(key) ? key : 'plain',
  });
  function item(type = 'text') {
    return {
      id: uid(),
      type,
      x: 0.12,
      y: 0.3,
      w: 0.76,
      h: 0.3,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      text: '',
      font: 'sans-serif',
      size: 0.065,
      weight: 700,
      italic: false,
      align: 'center',
      lineHeight: 1.25,
      tracking: 0,
      color: '#ffffff',
      color2: '#ffc66d',
      gradient: false,
      effect: 'none',
      effectAmount: 0.6,
      textStyle: 'plain',
      stroke: '#111827',
      strokeWidth: 0,
      shadow: 0,
      shadowColor: '#000000',
      panel: false,
      panelColor: '#111827',
      panelOpacity: 0.75,
      radius: type === 'image' ? 0 : 0.02,
      shape: 'rect',
      fit: 'cover',
      imageTint: false,
      imageTintColor: '#ffffff',
      enter: 'none',
      exit: 'none',
      delay: 0,
      animDuration: 0.7,
    };
  }
  function page(name = '') {
    return {
      id: uid(),
      name,
      bg: '#18233d',
      bg2: '#40315b',
      gradient: true,
      items: [],
    };
  }
  function occurrence(pageId, duration = 5) {
    return { id: uid(), pageId, duration, transition: 'cut' };
  }
  function project() {
    const p = page();
    return {
      format: 'mvmdesign',
      version: 1,
      name: '',
      width: 1920,
      height: 1080,
      pages: [p],
      assets: {},
      sequence: [occurrence(p.id)],
      audio: null,
      captions: [],
      captionDrafts: [],
      captionText: '',
      captionRules: [],
      captionAutoStyle: false,
      captionStyles: [],
      captionStyle: {
        preset: 'outline',
        font: 'sans-serif',
        size: 0.048,
        color: '#ffffff',
        highlight: '#ffcf4a',
        color2: '#ffc66d',
        gradient: false,
        panel: false,
        effect: 'none',
        effectAmount: 0.6,
        textStyle: 'outline',
        stroke: '#111827',
        strokeWidth: 5,
        shadow: 0,
        shadowColor: '#000000',
        panelColor: '#111827',
        panelOpacity: 0.8,
        opacity: 1,
        align: 'center',
        weight: 700,
        italic: false,
        tracking: 0,
        lineHeight: 1.3,
        x: 0.06,
        w: 0.88,
        h: 0.22,
        y: 0.78,
        enter: 'none',
        exit: 'none',
        animDuration: 0.3,
      },
    };
  }
  function schedule(p) {
    let start = 0;
    return p.sequence.map((c) => {
      const out = { ...c, start, end: start + c.duration };
      start = out.end;
      return out;
    });
  }
  function duration(p) {
    return p.sequence.reduce((s, c) => s + c.duration, 0);
  }
  function at(p, t) {
    const s = schedule(p);
    return (
      s.find((c) => t >= c.start && t < c.end) ||
      (t >= duration(p) ? s.at(-1) : null)
    );
  }
  // Keep a move's duration intact; trimming changes only the chosen edge.
  function retimeCue(cue, kind, delta, limit = 86400) {
    const minimum = Math.min(0.1, cue.end - cue.start);
    if (kind === 'start')
      return { ...cue, start: clamp(cue.start + delta, 0, cue.end - minimum) };
    if (kind === 'end')
      return {
        ...cue,
        end: clamp(
          cue.end + delta,
          cue.start + minimum,
          Math.max(limit, cue.start + minimum),
        ),
      };
    const length = cue.end - cue.start;
    const start = clamp(cue.start + delta, 0, Math.max(0, limit - length));
    return { ...cue, start, end: start + length };
  }
  function cueLanes(cues) {
    const ends = [];
    return cues
      .slice()
      .sort((a, b) => a.start - b.start || a.end - b.end)
      .map((cue) => {
        let lane = ends.findIndex((end) => end <= cue.start + 1e-6);
        if (lane < 0) lane = ends.length;
        ends[lane] = cue.end;
        return { ...cue, lane };
      });
  }
  // A style owns one track; simultaneous cues within it retain separate lanes.
  function captionTracks(p) {
    const styles = new Map((p.captionStyles || []).map((s) => [s.id, s])),
      tracks = new Map();
    for (const cue of p.captions) {
      const style = styles.get(cue.styleId),
        id = style?.id || '';
      if (!tracks.has(id))
        tracks.set(id, { styleId: id, name: style?.name || '', cues: [] });
      tracks.get(id).cues.push(cue);
    }
    return [...tracks.values()]
      .map((track) => ({ ...track, cues: cueLanes(track.cues) }))
      .sort((a, b) => a.cues[0].start - b.cues[0].start);
  }
  function cleanCaptionStyle(raw = {}, partial = false) {
    const defaults = project().captionStyle,
      out = {};
    raw = raw || {};
    for (const k of Object.keys(defaults)) {
      if (partial && !Object.hasOwn(raw, k)) continue;
      const v = raw[k];
      if (
        [
          'color',
          'color2',
          'highlight',
          'stroke',
          'shadowColor',
          'panelColor',
        ].includes(k)
      )
        out[k] = color(v, defaults[k]);
      else if (
        [
          'x',
          'y',
          'w',
          'h',
          'size',
          'animDuration',
          'strokeWidth',
          'shadow',
          'panelOpacity',
          'opacity',
          'tracking',
          'lineHeight',
          'effectAmount',
        ].includes(k)
      ) {
        const limits = {
          effectAmount: [0, 1],
          strokeWidth: [0, 20],
          shadow: [0, 80],
          panelOpacity: [0, 1],
          opacity: [0, 1],
          tracking: [-5, 30],
          lineHeight: [0.7, 3],
          x: [0, 1],
          y: [0, 1],
          w: [0.05, 1],
          h: [0.05, 1],
          size: [0.015, 0.2],
          animDuration: [0.05, 3],
        }[k];
        out[k] = v == null ? defaults[k] : clamp(v, ...limits);
      } else if (['italic', 'gradient', 'panel'].includes(k)) out[k] = !!v;
      else if (k === 'weight')
        out[k] = [400, 700, 900].includes(+v) ? +v : defaults[k];
      else if (k === 'align')
        out[k] = ['left', 'center', 'right'].includes(v) ? v : defaults[k];
      else if (k === 'effect') out[k] = textEffects.includes(v) ? v : 'none';
      else if (k === 'textStyle') out[k] = textStyles.includes(v) ? v : 'plain';
      else if (k === 'font') out[k] = String(v || defaults[k]).slice(0, 100);
      else if (k === 'preset')
        out[k] = [
          'custom',
          'outline',
          'box',
          'karaoke',
          'typewriter',
          'glow',
        ].includes(v)
          ? v
          : defaults[k];
      else out[k] = animations.includes(v) ? v : defaults[k];
    }
    return out;
  }
  const captionStyle = (p, cue) => ({
    ...p.captionStyle,
    ...((p.captionStyles || []).find((style) => style.id === cue.styleId)
      ?.style || {}),
    ...(cue.style || {}),
  });
  function captionBox(p, cue, index = 0) {
    const s = captionStyle(p, cue),
      w = s.w ?? 0.88,
      h = s.h ?? 0.22;
    return {
      id: cue.id,
      x: Math.min(1 - w, s.x ?? 0.06),
      y: Math.max(
        0,
        Math.min(1 - h, s.y) -
          (Object.hasOwn(cue.style || {}, 'y') ||
          (p.captionStyles || []).some((s) => s.id === cue.styleId)
            ? 0
            : index * h),
      ),
      w,
      h,
      rotation: 0,
    };
  }
  // Number placed captions chronologically, followed by unplaced library entries.
  // An entry currently being timed appears only once.
  function captionTargets(p, scope = 'all') {
    const placed = p.captions.slice().sort((a, b) => a.start - b.start);
    const drafts = (p.captionDrafts || []).filter(
      (d) => !d.timingKey || !placed.some((c) => c.timingKey === d.timingKey),
    );
    return (
      scope === 'drafts' ? [] : placed.map((cue) => ({ cue, placed: true }))
    ).concat(
      scope === 'placed' ? [] : drafts.map((cue) => ({ cue, placed: false })),
    );
  }
  function captionPattern(targets, start = 1, every = 1, end = targets.length) {
    start = Math.max(1, Math.floor(+start || 1));
    every = Math.max(1, Math.floor(+every || 1));
    end = Math.min(targets.length, Math.max(0, Math.floor(+end || 0)));
    return targets.filter(
      (_, i) => i + 1 >= start && i + 1 <= end && (i + 1 - start) % every === 0,
    );
  }
  // Hold: a matched subtitle stays until the end of the last subtitle of its group
  // (groups are blocks of `every` placed subtitles). The last subtitle of an
  // incomplete group closes it. Returns true when an end time changed.
  function holdCaptions(p, rule) {
    if (!rule.hold) return false;
    const start = Math.max(1, Math.floor(+rule.start) || 1),
      every = Math.max(1, Math.floor(+rule.every) || 1);
    const placed = captionTargets(p, 'placed').map((t) => t.cue);
    let changed = false;
    placed.forEach((cue, i) => {
      const n = i + 1;
      if (n < start || (n - start) % every) return;
      const block = Math.floor((n - 1) / every);
      const endPos = Math.min(placed.length, (block + 1) * every);
      if (endPos <= n) return;
      const end = Math.max(cue.start + 0.01, placed[endPos - 1].end);
      if (Math.abs(cue.end - end) > 1e-6) {
        cue.end = end;
        changed = true;
      }
    });
    return changed;
  }
  // Automatic style rules: numbering follows captionTargets order, so adding,
  // deleting or moving subtitles reassigns styles. Returns true when anything changed.
  function applyCaptionRules(p) {
    const rules = p.captionRules || [];
    if (!rules.length) return false;
    const known = new Set((p.captionStyles || []).map((s) => s.id));
    const live = rules.filter((r) => r.styleId === '' || known.has(r.styleId));
    if (live.length !== rules.length) p.captionRules = live;
    let changed = live.length !== rules.length;
    const targets = captionTargets(p, 'all');
    const linked = new Map();
    for (const c of [...p.captions, ...(p.captionDrafts || [])]) {
      if (!c.timingKey) continue;
      if (!linked.has(c.timingKey)) linked.set(c.timingKey, []);
      linked.get(c.timingKey).push(c);
    }
    targets.forEach(({ cue }, i) => {
      const n = i + 1;
      let rule = null;
      for (const r of live) if (n >= r.start && (n - r.start) % r.every === 0) rule = r;
      if (!rule) return;
      for (const c of new Set([cue, ...(linked.get(cue.timingKey) || [])])) {
        if ((c.styleId || '') === rule.styleId) continue;
        if (rule.styleId) c.styleId = rule.styleId;
        else delete c.styleId;
        changed = true;
      }
    });
    for (const r of live) if (holdCaptions(p, r)) changed = true;
    return changed;
  }
  // Use pixel tolerances at the current zoom; all geometry stays resolution independent.
  function snapResizeBox(box, tolerance = { x: 0.008, y: 0.008 }) {
    const out = { ...box }, guides = [];
    // Only the dragged right/bottom edges move; the opposite corner stays fixed.
    for (const [axis, size] of [['x', 'w'], ['y', 'h']]) {
      const edge = box[axis] + box[size];
      const target = [0, 1].find(value =>
        Math.abs(edge - value) <= tolerance[axis] && value - box[axis] >= 0.02 && value - box[axis] <= 3);
      if (target !== undefined) {
        out[size] = target - box[axis];
        guides.push({ axis, value: target });
      }
    }
    return { box: out, guides };
  }
  function snapBox(box, others, tolerance = { x: 0.008, y: 0.008 }) {
    const out = { ...box },
      guides = [];
    for (const [axis, dim, cross, span] of [
      ['x', 'w', 'y', 'h'],
      ['y', 'h', 'x', 'w'],
    ]) {
      const candidates = [];
      const anchors = (b) => [b[axis], b[axis] + b[dim] / 2, b[axis] + b[dim]];
      for (const target of [{ x: 0, y: 0, w: 1, h: 1 }, ...others])
        for (const a of anchors(box))
          for (const b of anchors(target))
            candidates.push({ delta: b - a, guide: { axis, value: b } });
      // Equal gaps between neighbors, and repeating the spacing of any neighboring pair.
      const sorted = others
        .filter(
          (o) =>
            box[cross] < o[cross] + o[span] &&
            box[cross] + box[span] > o[cross],
        )
        .sort((a, b) => a[axis] - b[axis]);
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i],
          b = sorted[i + 1],
          gap = b[axis] - a[axis] - a[dim];
        if (gap < 0) continue;
        for (const [position, ranges] of [
          [
            (a[axis] + a[dim] + b[axis] - box[dim]) / 2,
            [
              [a[axis] + a[dim], null],
              [null, b[axis]],
            ],
          ],
          [
            b[axis] + b[dim] + gap,
            [
              [a[axis] + a[dim], b[axis]],
              [b[axis] + b[dim], null],
            ],
          ],
          [
            a[axis] - gap - box[dim],
            [
              [null, a[axis]],
              [a[axis] + a[dim], b[axis]],
            ],
          ],
        ]) {
          const end = position + box[dim];
          const resolved = ranges
            .map(([lo, hi]) => [lo ?? end, hi ?? position])
            .map(([lo, hi]) => [Math.min(lo, hi), Math.max(lo, hi)]);
          candidates.push({
            delta: position - box[axis],
            guide: { axis, gaps: resolved, at: box[cross] + box[span] / 2 },
          });
        }
      }
      const best = candidates
        .filter((c) => Math.abs(c.delta) <= tolerance[axis])
        .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0];
      if (best) {
        out[axis] += best.delta;
        const seen = new Set();
        for (const candidate of candidates.filter(
          (c) => Math.abs(c.delta - best.delta) < 1e-8,
        )) {
          const key = JSON.stringify(candidate.guide);
          if (!seen.has(key)) {
            guides.push(candidate.guide);
            seen.add(key);
          }
        }
      }
    }
    return { box: out, guides };
  }
  function normalize(raw) {
    if (
      !raw ||
      raw.format !== 'mvmdesign' ||
      raw.version !== 1 ||
      !Array.isArray(raw.pages) ||
      !raw.pages.length ||
      raw.pages.length > 500
    )
      throw Error('invalidProject');
    const p = project();
    p.name = String(raw.name || '').slice(0, 200);
    p.width = Math.round(clamp(raw.width, 64, 7680));
    p.height = Math.round(clamp(raw.height, 64, 7680));
    if (p.width * p.height > 34e6) throw Error('invalidProject');
    p.assets = {};
    for (const [key, a] of Object.entries(raw.assets || {}))
      if (a && /^data:image\/(png|jpeg|webp|gif|avif|bmp);base64,/i.test(a.src))
        p.assets[key] = {
          src: a.src,
          name: String(a.name || '').slice(0, 200),
        };
    const pageIds = new Set();
    p.pages = raw.pages.map((r) => {
      const pg = page(String(r.name || '').slice(0, 120));
      pg.id = typeof r.id === 'string' && !pageIds.has(r.id) ? r.id : uid();
      pageIds.add(pg.id);
      pg.bg = color(r.bg, '#18233d');
      pg.bg2 = color(r.bg2, pg.bg);
      pg.gradient = !!r.gradient;
      pg.items = (Array.isArray(r.items) ? r.items : [])
        .slice(0, 300)
        .map((o) => {
          const type = ['text', 'shape', 'image'].includes(o.type)
              ? o.type
              : 'text',
            v = item(type);
          for (const key of ['text', 'font', 'assetId'])
            if (typeof o[key] === 'string')
              v[key] = o[key].slice(0, key === 'text' ? 20000 : 200);
          for (const key of [
            'color',
            'color2',
            'stroke',
            'shadowColor',
            'panelColor',
            'imageTintColor',
          ])
            v[key] = color(o[key], v[key]);
          for (const key of ['locked', 'hidden', 'italic', 'gradient', 'panel', 'imageTint'])
            v[key] = !!o[key];
          for (const [key, lo, hi] of [
            ['x', -2, 2],
            ['y', -2, 2],
            ['w', 0.005, 3],
            ['h', 0.005, 3],
            ['rotation', -360, 360],
            ['opacity', 0, 1],
            ['size', 0.005, 1],
            ['lineHeight', 0.7, 3],
            ['tracking', -5, 30],
            ['effectAmount', 0, 1],
            ['strokeWidth', 0, 20],
            ['shadow', 0, 80],
            ['panelOpacity', 0, 1],
            ['radius', 0, 0.5],
            ['delay', 0, 3600],
            ['animDuration', 0.05, 10],
          ])
            v[key] = o[key] == null ? v[key] : clamp(o[key], lo, hi);
          v.effect = textEffects.includes(o.effect) ? o.effect : 'none';
          v.textStyle = textStyles.includes(o.textStyle)
            ? o.textStyle
            : 'plain';
          v.weight = [400, 700, 900].includes(+o.weight) ? +o.weight : 700;
          v.align = ['left', 'center', 'right'].includes(o.align)
            ? o.align
            : 'center';
          v.shape = ['rect', 'ellipse', 'line'].includes(o.shape)
            ? o.shape
            : 'rect';
          v.fit = o.fit === 'contain' ? 'contain' : 'cover';
          for (const k of ['enter', 'exit'])
            v[k] = animations.includes(o[k]) ? o[k] : 'none';
          return v;
        });
      return pg;
    });
    p.sequence = (Array.isArray(raw.sequence) ? raw.sequence : [])
      .slice(0, 5000)
      .filter((c) => c && pageIds.has(c.pageId))
      .map((c) => ({
        ...occurrence(c.pageId, clamp(c.duration, 0.1, 86400)),
        transition: c.transition === 'fade' ? 'fade' : 'cut',
      }));
    if (!p.sequence.length) p.sequence = [occurrence(p.pages[0].id)];
    const styleIds = new Set();
    p.captionStyles = (
      Array.isArray(raw.captionStyles) ? raw.captionStyles : []
    )
      .slice(0, 200)
      .filter((s) => s && typeof s.name === 'string' && s.name.trim())
      .map((s) => {
        const id =
          typeof s.id === 'string' &&
          s.id &&
          s.id.length <= 100 &&
          !styleIds.has(s.id)
            ? s.id
            : uid();
        styleIds.add(id);
        return {
          id,
          name: s.name.trim().slice(0, 100),
          style: cleanCaptionStyle(s.style),
        };
      });
    p.captions = (Array.isArray(raw.captions) ? raw.captions : [])
      .slice(0, 10000)
      .filter((c) => c && +c.end > +c.start && +c.start >= 0)
      .map((c) => ({
        id: uid(),
        start: clamp(c.start, 0, 86400),
        end: clamp(c.end, 0, 86400),
        text: String(c.text || '').slice(0, 5000),
        style: cleanCaptionStyle(c.style, true),
        ...(styleIds.has(c.styleId) ? { styleId: c.styleId } : {}),
        ...(typeof c.timingKey === 'string'
          ? { timingKey: c.timingKey.slice(0, 100) }
          : {}),
      }));
    p.captionStyle = cleanCaptionStyle(raw.captionStyle);
    p.captionRules = (Array.isArray(raw.captionRules) ? raw.captionRules : [])
      .slice(0, 50)
      .filter((r) => r && typeof r.styleId === 'string' && (r.styleId === '' || styleIds.has(r.styleId)))
      .map((r) => ({
        styleId: r.styleId,
        start: Math.max(1, Math.min(100000, Math.floor(+r.start) || 1)),
        every: Math.max(1, Math.min(100000, Math.floor(+r.every) || 1)),
        hold: r.hold ? 1 : 0,
      }));
    p.captionAutoStyle = raw.captionAutoStyle === true;
    p.captionText =
      typeof raw.captionText === 'string' ? raw.captionText.slice(0, 200000) : '';
    p.captionDrafts = (
      Array.isArray(raw.captionDrafts) ? raw.captionDrafts : []
    )
      .slice(0, 10000)
      .filter((c) => c && typeof c.text === 'string')
      .map((c) => ({
        id: uid(),
        text: c.text.slice(0, 5000),
        style: cleanCaptionStyle(c.style, true),
        ...(styleIds.has(c.styleId) ? { styleId: c.styleId } : {}),
        ...(typeof c.timingKey === 'string'
          ? { timingKey: c.timingKey.slice(0, 100) }
          : {}),
      }));
    let activeKey;
    for (const c of p.captions) {
      if (
        c.timingKey &&
        !activeKey &&
        p.captionDrafts.some((d) => d.timingKey === c.timingKey)
      )
        activeKey = c.timingKey;
      else delete c.timingKey;
    }
    let linked = false;
    for (const d of p.captionDrafts) {
      if (activeKey && !linked && d.timingKey === activeKey) linked = true;
      else delete d.timingKey;
    }
    if (raw.audio && /^data:audio\/[\w.+-]+;base64,/i.test(raw.audio.data))
      p.audio = {
        name: String(raw.audio.name || '').slice(0, 200),
        data: raw.audio.data,
        duration: clamp(raw.audio.duration, 0, 86400),
      };
    return p;
  }
  const stamp = (t) => {
    const n = Math.max(0, Math.round(t * 1000));
    return `${String(Math.floor(n / 3600000)).padStart(2, '0')}:${String(Math.floor(n / 60000) % 60).padStart(2, '0')}:${String(Math.floor(n / 1000) % 60).padStart(2, '0')},${String(n % 1000).padStart(3, '0')}`;
  };
  function parseSrt(src) {
    const cues = [];
    const re =
      /(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})[^\n]*\n([\s\S]*?)(?=\n\s*\n|$)/g;
    for (const m of src.replace(/\r/g, '').matchAll(re)) {
      const start = (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000,
        end = (+m[5] || 0) * 3600 + +m[6] * 60 + +m[7] + +m[8] / 1000;
      if (end > start)
        cues.push({
          id: uid(),
          start,
          end,
          text: m[9].replace(/<[^>]*>/g, '').trim(),
        });
    }
    return cues;
  }
  const toSrt = (cues) =>
    cues
      .slice()
      .sort((a, b) => a.start - b.start)
      .map(
        (c, i) =>
          `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`,
      )
      .join('\n');
  window.MvmDesignModel = {
    uid,
    clone,
    clamp,
    item,
    page,
    project,
    occurrence,
    schedule,
    duration,
    at,
    normalize,
    cleanCaptionStyle,
    captionStyle,
    captionTargets,
    captionPattern,
    applyCaptionRules,
    holdCaptions,
    captionBox,
    snapBox,
    snapResizeBox,
    animations,
    textEffects,
    textStyles,
    textPreset,
    retimeCue,
    cueLanes,
    captionTracks,
    parseSrt,
    toSrt,
  };
})();

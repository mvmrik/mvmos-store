window.MvmDesignRender = (function createRenderer() {
  'use strict';
  const M = window.MvmDesignModel;
  const cache = new Map();
  const imageVariants = new Map();
  let variantPixels = 0;
  const maxVariantPixels = 16 * 1024 * 1024;
  function discardVariant(key) {
    const value = imageVariants.get(key);
    variantPixels -= value.canvas.width * value.canvas.height;
    imageVariants.delete(key);
  }
  function sampledImage(id, image, targetW, targetH, tint) {
    let width = image.width, height = image.height, level = 0;
    // Pick a power-of-two level just above the actual transformed device size.
    while (width / 2 >= targetW && height / 2 >= targetH && width > 1 && height > 1) {
      width = Math.max(1, Math.floor(width / 2));
      height = Math.max(1, Math.floor(height / 2));
      level++;
    }
    if (!level && !tint) return image;
    const key = `${id}:${level}:${tint || ''}`;
    const cached = imageVariants.get(key);
    if (cached?.image === image) {
      imageVariants.delete(key);
      imageVariants.set(key, cached);
      return cached.canvas;
    }
    if (cached) discardVariant(key);
    let source = image;
    // Progressive reduction preserves thin strokes and transparent antialiased edges.
    for (let step = 0; step < Math.max(1, level); step++) {
      const canvas = document.createElement('canvas');
      canvas.width = level ? Math.max(1, Math.floor(source.width / 2)) : width;
      canvas.height = level ? Math.max(1, Math.floor(source.height / 2)) : height;
      const context = canvas.getContext('2d');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      source = canvas;
    }
    if (tint) {
      const context = source.getContext('2d');
      context.globalCompositeOperation = 'source-in';
      context.fillStyle = tint;
      context.fillRect(0, 0, source.width, source.height);
      context.globalCompositeOperation = 'source-over';
    }
    const pixels = source.width * source.height;
    if (pixels <= maxVariantPixels) {
      while (imageVariants.size && (variantPixels + pixels > maxVariantPixels || imageVariants.size >= 32))
        discardVariant(imageVariants.keys().next().value);
      imageVariants.set(key, { image, canvas: source, id });
      variantPixels += pixels;
    }
    return source;
  }
  async function prepare(p) {
    const wanted = new Set(
      p.pages.flatMap((pg) =>
        pg.items.filter((i) => i.type === 'image').map((i) => i.assetId),
      ),
    );
    for (const id of cache.keys()) if (!wanted.has(id)) cache.delete(id);
    await Promise.all(
      [...wanted].map(async (id) => {
        const src = p.assets[id]?.src;
        if (!src) throw Error('missingImage');
        if (cache.get(id)?.src === src) return;
        const image = new Image();
        image.src = src;
        await image.decode();
        cache.set(id, image);
      }),
    );
    for (const [key, value] of imageVariants)
      if (cache.get(value.id) !== value.image) discardVariant(key);
    const fonts = [
      ...new Set(
        p.pages
          .flatMap((pg) =>
            pg.items.filter((i) => i.type === 'text').map((i) => i.font),
          )
          .concat(
            p.captionStyle.font,
            ...p.captions.map((c) => M.captionStyle(p, c).font).filter(Boolean),
            ...(p.captionStyles || []).map((s) => s.style.font),
          ),
      ),
    ];
    if (window.MvmFontsClient) {
      const text = p.pages
        .flatMap((pg) => pg.items.map((i) => i.text || ''))
        .concat(p.captions.map((c) => c.text))
        .join('');
      const sample = [...new Set(Array.from(text))].join('') || 'AaЖя';
      await window.MvmFontsClient.ready(fonts, sample);
      // A missing installed font must not silently change a finished export.
      for (const f of fonts.filter((f) => window.MvmFontsClient.has(f)))
        if (!document.fonts.check(`16px "${f}"`)) throw Error('fontFailed');
    }
    await document.fonts.ready;
  }
  const font = (it, size) => {
    const f = String(it.font || 'sans-serif').replace(/["\\]/g, '');
    return `${it.italic ? 'italic ' : ''}${it.weight || 700} ${size}px ${['sans-serif', 'serif', 'monospace'].includes(f) ? f : '"' + f + '", sans-serif'}`;
  };
  const ease = (n) => 1 - (1 - Math.max(0, Math.min(1, n))) ** 3;
  function motion(it, local, length) {
    const dur = Math.max(0.001, Math.min(it.animDuration || 0.7, length / 2)),
      delay = it.delay || 0;
    const a = {
      alpha: 1,
      dx: 0,
      dy: 0,
      scale: 1,
      reveal: 1,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      blur: 0,
      clip: null,
    };
    if (local < delay) return { ...a, alpha: 0, reveal: 0 };
    const bounce = (q) => {
      const n = 7.5625,
        d = 2.75;
      if (q < 1 / d) return n * q * q;
      if (q < 2 / d) return n * (q -= 1.5 / d) * q + 0.75;
      if (q < 2.5 / d) return n * (q -= 2.25 / d) * q + 0.9375;
      return n * (q -= 2.625 / d) * q + 0.984375;
    };
    function apply(kind, progress) {
      if (!kind || kind === 'none') return;
      const raw = Math.max(0, Math.min(1, progress)),
        q = ease(raw),
        rest = 1 - q;
      if (kind === 'typewriter' || kind === 'words') {
        a.reveal *= raw;
        return;
      }
      a.alpha *= q;
      if (kind === 'left') a.dx -= rest * 0.2;
      if (kind === 'right') a.dx += rest * 0.2;
      if (kind === 'up') a.dy -= rest * 0.2;
      if (kind === 'down') a.dy += rest * 0.2;
      if (kind === 'zoom') a.scale *= 0.65 + 0.35 * q;
      if (kind === 'zoomLarge') a.scale *= 1 + 0.6 * rest;
      if (kind === 'pop') {
        const back = 1 + 2.70158 * (raw - 1) ** 3 + 1.70158 * (raw - 1) ** 2;
        a.scale *= 0.3 + 0.7 * back;
      }
      if (kind === 'bounce') a.dy -= 0.3 * (1 - bounce(raw));
      if (kind === 'elastic') {
        const spring =
          raw === 0 || raw === 1
            ? raw
            : 2 ** (-10 * raw) *
                Math.sin(((raw * 10 - 0.75) * 2 * Math.PI) / 3) +
              1;
        a.scale *= 0.3 + 0.7 * spring;
      }
      if (kind === 'rotate') a.rotation -= (rest * Math.PI) / 3;
      if (kind === 'spin') {
        a.rotation -= rest * Math.PI * 2;
        a.scale *= 0.3 + 0.7 * q;
      }
      if (kind === 'flipX')
        a.scaleY *= Math.max(0.001, Math.cos((rest * Math.PI) / 2));
      if (kind === 'flipY')
        a.scaleX *= Math.max(0.001, Math.cos((rest * Math.PI) / 2));
      if (kind === 'diagonalLeft') {
        a.dx -= rest * 0.2;
        a.dy += rest * 0.2;
      }
      if (kind === 'diagonalRight') {
        a.dx += rest * 0.2;
        a.dy += rest * 0.2;
      }
      if (kind === 'blur') a.blur += rest * 0.018;
      if (kind === 'stretchX') a.scaleX *= 0.05 + 0.95 * q;
      if (kind === 'stretchY') a.scaleY *= 0.05 + 0.95 * q;
      if (kind.startsWith('wipe') && q < 1) {
        const c =
          kind === 'wipeLeft'
            ? { x: 0, y: 0, w: q, h: 1 }
            : kind === 'wipeRight'
              ? { x: rest, y: 0, w: q, h: 1 }
              : kind === 'wipeUp'
                ? { x: 0, y: 0, w: 1, h: q }
                : { x: 0, y: rest, w: 1, h: q };
        if (a.clip) {
          const x = Math.max(a.clip.x, c.x),
            y = Math.max(a.clip.y, c.y);
          a.clip = {
            x,
            y,
            w: Math.max(0, Math.min(a.clip.x + a.clip.w, c.x + c.w) - x),
            h: Math.max(0, Math.min(a.clip.y + a.clip.h, c.y + c.h) - y),
          };
        } else a.clip = c;
      }
    }
    apply(it.enter, (local - delay) / dur);
    apply(it.exit, (length - local) / dur);
    return a;
  }
  function motionTransform(ctx, a, w, h, H) {
    ctx.rotate(a.rotation || 0);
    ctx.scale(a.scale * (a.scaleX ?? 1), a.scale * (a.scaleY ?? 1));
    ctx.translate(-w / 2, -h / 2);
    if (a.clip) {
      ctx.beginPath();
      ctx.rect(a.clip.x * w, a.clip.y * h, a.clip.w * w, a.clip.h * h);
      ctx.clip();
    }
    if (a.blur > 0) ctx.filter = `blur(${a.blur * H}px)`;
  }
  function lines(ctx, text, max) {
    const out = [];
    for (const para of String(text).split('\n')) {
      if (!para) {
        out.push('');
        continue;
      }
      let line = '';
      for (const word of para.split(/\s+/)) {
        const candidate = line ? line + ' ' + word : word;
        if (ctx.measureText(candidate).width <= max) {
          line = candidate;
          continue;
        }
        if (line) {
          out.push(line);
          line = '';
        }
        for (const ch of Array.from(word)) {
          if (line && ctx.measureText(line + ch).width > max) {
            out.push(line);
            line = '';
          }
          line += ch;
        }
      }
      out.push(line);
    }
    return out;
  }
  function rounded(ctx, x, y, w, h, radius) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, Math.min(radius, w / 2, h / 2));
  }
  // Draw actual glyph layers, shared by page text, captions and style thumbnails.
  function paintText(ctx, it, text, x, y, size, fill, H, highlight = false) {
    if (!text) return;
    const effect = it.effect || 'none',
      amount = it.effectAmount ?? 0.6,
      depth = size * (0.035 + 0.16 * amount),
      accent = it.color2;
    ctx.save();
    if (it.gradient && !highlight) {
      const gradient = ctx.createLinearGradient(0, y, 0, y + size);
      gradient.addColorStop(0, it.color);
      gradient.addColorStop(1, it.color2);
      fill = gradient;
    }
    const stroke = () => {
      if (it.strokeWidth > 0) {
        ctx.strokeStyle = it.stroke;
        ctx.lineWidth = (it.strokeWidth * H) / 1080;
        ctx.strokeText(text, x, y);
      }
    };
    const layer = (dx, dy, color, alpha = 1) => {
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.fillStyle = color;
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.fillText(text, x + dx, y + dy);
      ctx.restore();
    };
    if (!highlight) {
      if (effect === 'extrude')
        for (let n = 12; n > 0; n--)
          layer((depth * n) / 12, (depth * n) / 12, accent);
      if (effect === 'retro')
        for (let n = 4; n > 0; n--)
          layer(
            depth * n,
            depth * n,
            [accent, it.stroke, accent, it.stroke][n - 1],
          );
      if (effect === 'echo')
        for (let n = 3; n > 0; n--)
          layer(-depth * n, depth * n, accent, 0.18 + 0.14 * (3 - n));
      if (effect === 'glitch') {
        layer(-depth, 0, accent, 0.9);
        layer(depth, 0, '#ff3f86', 0.9);
        for (let n = 0; n < 3; n++) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(
            x - depth * 2,
            y + size * (0.15 + n * 0.26),
            ctx.measureText(text).width + depth * 4,
            size * 0.065,
          );
          ctx.clip();
          layer((n % 2 ? 1 : -1) * depth * 1.8, 0, accent);
          ctx.restore();
        }
      }
      if (effect === 'chromatic') {
        layer(-depth, depth * 0.35, accent);
        layer(depth, -depth * 0.35, '#ff5d9e');
      }
      if (effect === 'emboss') {
        layer(depth * 0.4, depth * 0.5, accent);
        layer(-depth * 0.4, -depth * 0.5, '#ffffff', 0.8);
      }
      if (effect === 'splice') {
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.lineWidth = Math.max(1, size * 0.035);
        ctx.strokeStyle = accent;
        ctx.strokeText(text, x + depth, y + depth);
        ctx.restore();
      }
      if (effect === 'double') {
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.lineJoin = 'round';
        ctx.lineWidth =
          Math.max(2, (it.strokeWidth * H) / 1080) +
          size * (0.05 + 0.12 * amount);
        ctx.strokeStyle = accent;
        ctx.strokeText(text, x, y);
        ctx.restore();
      }
      if (effect === 'neon') {
        ctx.save();
        ctx.shadowOffsetY = 0;
        ctx.shadowColor = accent;
        ctx.strokeStyle = accent;
        ctx.lineWidth = size * 0.045;
        for (const blur of [
          size * (0.2 + amount),
          size * (0.1 + 0.4 * amount),
          size * 0.12,
        ]) {
          ctx.shadowBlur = blur;
          ctx.strokeText(text, x, y);
        }
        ctx.restore();
      }
    }
    if (effect === 'hollow' && !highlight) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = it.color;
      ctx.lineWidth =
        Math.max(size * 0.018, (it.strokeWidth * H) / 1080) * (0.4 + amount);
      ctx.strokeText(text, x, y);
    } else {
      stroke();
      if (effect === 'metal' && !highlight) {
        const g = ctx.createLinearGradient(0, y, 0, y + size);
        for (const [stop, color] of [
          [0, it.color],
          [0.28, accent],
          [0.35 + amount * 0.16, it.color],
          [0.39 + amount * 0.16, '#ffffff'],
          [0.42 + amount * 0.16, accent],
          [0.78, it.color],
          [1, accent],
        ])
          g.addColorStop(stop, color);
        ctx.fillStyle = g;
      } else if (effect === 'striped' && !highlight) {
        const g = ctx.createLinearGradient(0, y, 0, y + size);
        const count = 4 + Math.round(amount * 12);
        for (let n = 0; n < count; n++) {
          g.addColorStop(n / count, n % 2 ? accent : it.color);
          g.addColorStop((n + 0.99) / count, n % 2 ? accent : it.color);
        }
        ctx.fillStyle = g;
      } else ctx.fillStyle = fill;
      ctx.fillText(text, x, y);
    }
    ctx.restore();
  }
  function drawText(ctx, it, w, h, H, reveal = 1, karaoke = -1) {
    // The box controls wrapping and alignment, never the chosen font size.
    // Shrinking to its height makes glyphs smaller whenever wrapping adds a line.
    const size = it.size * H;
    ctx.font = font(it, size);
    if ('letterSpacing' in ctx)
      ctx.letterSpacing = ((it.tracking || 0) * H) / 1080 + 'px';
    const ls = lines(ctx, it.text, Math.max(1, w - size * 0.2));
    const lh = size * it.lineHeight,
      top = (h - ls.length * lh) / 2;
    if (it.panel) {
      ctx.save();
      ctx.globalAlpha *= it.panelOpacity;
      ctx.fillStyle = it.panelColor;
      rounded(ctx, 0, 0, w, h, H * it.radius);
      ctx.fill();
      ctx.restore();
    }
    let fill = it.color;
    if (it.gradient) {
      fill = ctx.createLinearGradient(0, 0, 0, h);
      fill.addColorStop(0, it.color);
      fill.addColorStop(1, it.color2);
    }
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    ctx.shadowColor = it.shadowColor;
    ctx.shadowBlur = (it.shadow * H * (0.4 + (it.effectAmount ?? 0.6))) / 1080;
    ctx.shadowOffsetY = it.shadow ? size * 0.06 : 0;
    ctx.lineWidth = (it.strokeWidth * H) / 1080;
    ctx.strokeStyle = it.stroke;
    let remaining = Math.ceil(Array.from(ls.join('')).length * reveal);
    let remainingWords = Math.ceil(
      it.text.trim().split(/\s+/).filter(Boolean).length * reveal,
    );
    const totalWords = ls.reduce(
      (s, l) => s + l.split(/\s+/).filter(Boolean).length,
      0,
    );
    let wordIndex = 0;
    ls.forEach((line, n) => {
      const width = ctx.measureText(line).width;
      let x =
        it.align === 'left'
          ? size * 0.1
          : it.align === 'right'
            ? w - size * 0.1 - width
            : (w - width) / 2;
      const y = top + n * lh;
      if (karaoke >= 0) {
        const words = line.match(/\S+\s*/g) || [];
        for (const word of words) {
          const done = karaoke * totalWords - wordIndex++;
          paintText(ctx, it, word, x, y, size, fill, H);
          if (done > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(
              x - 2,
              y - 2,
              ctx.measureText(word).width * Math.min(1, done) + 2,
              lh + 4,
            );
            ctx.clip();
            paintText(
              ctx,
              it,
              word,
              x,
              y,
              size,
              it.highlight || it.color2,
              H,
              true,
            );
            ctx.restore();
          }
          x += ctx.measureText(word).width;
        }
      } else {
        const chars = Array.from(line);
        let part = chars.slice(0, Math.max(0, remaining)).join('');
        if (it.enter === 'words' && reveal < 1) {
          const words = line.split(/\s+/).filter(Boolean);
          part = words.slice(0, Math.max(0, remainingWords)).join(' ');
          remainingWords -= words.length;
        }
        remaining -= chars.length;
        paintText(ctx, it, part, x, y, size, fill, H);
      }
    });
  }
  function drawItem(ctx, it, W, H, local, length, animated) {
    if (it.hidden) return;
    const a = animated
      ? motion(it, local, length)
      : { alpha: 1, dx: 0, dy: 0, scale: 1, reveal: 1 };
    if (a.alpha <= 0) return;
    const w = it.w * W,
      h = it.h * H;
    ctx.save();
    ctx.globalAlpha *= it.opacity * a.alpha;
    ctx.translate((it.x + it.w / 2 + a.dx) * W, (it.y + it.h / 2 + a.dy) * H);
    ctx.rotate((it.rotation * Math.PI) / 180);
    motionTransform(ctx, a, w, h, H);
    if (it.type === 'text') drawText(ctx, it, w, h, H, a.reveal);
    else if (it.type === 'shape') {
      ctx.fillStyle = it.color;
      if (it.gradient) {
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, it.color);
        g.addColorStop(1, it.color2);
        ctx.fillStyle = g;
      }
      ctx.strokeStyle = it.stroke;
      ctx.lineWidth = (it.strokeWidth * H) / 1080;
      ctx.shadowColor = it.shadowColor;
      ctx.shadowBlur =
        (it.shadow * H * (0.4 + (it.effectAmount ?? 0.6))) / 1080;
      if (it.shape === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      } else if (it.shape === 'line') {
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.strokeStyle = it.color;
        ctx.lineWidth = (Math.max(2, it.strokeWidth) * H) / 1080;
      } else rounded(ctx, 0, 0, w, h, it.radius * H);
      if (it.shape !== 'line') ctx.fill();
      if (it.strokeWidth > 0 || it.shape === 'line') ctx.stroke();
    } else {
      const im = cache.get(it.assetId);
      if (im) {
        // Images have rectangular bounds. Legacy projects inherited the generic
        // shape radius even though the image inspector never offered rounding.
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        ctx.clip();
        const scale =
          it.fit === 'contain'
            ? Math.min(w / im.width, h / im.height)
            : Math.max(w / im.width, h / im.height);
        const dw = im.width * scale, dh = im.height * scale;
        const transform = ctx.getTransform();
        const image = sampledImage(it.assetId, im,
          Math.max(1, dw * Math.hypot(transform.a, transform.b)),
          Math.max(1, dh * Math.hypot(transform.c, transform.d)),
          it.imageTint ? it.imageTintColor || '#ffffff' : null);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
      }
    }
    ctx.restore();
  }
  function itemPreview(ctx, p, item, W, H) {
    ctx.clearRect(0, 0, W, H);
    const scale = Math.min((W - 16) / (item.w * p.width), (H - 16) / (item.h * p.height));
    ctx.save();
    ctx.translate((W - item.w * p.width * scale) / 2, (H - item.h * p.height * scale) / 2);
    ctx.scale(scale, scale);
    drawItem(ctx, { ...item, hidden: false, x: 0, y: 0, rotation: 0 }, p.width, p.height, 0, 5, false);
    ctx.restore();
  }
  function page(ctx, p, pg, W, H, local = 0, length = 5, animated = false) {
    ctx.save();
    ctx.fillStyle = pg.bg;
    if (pg.gradient) {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, pg.bg);
      g.addColorStop(1, pg.bg2);
      ctx.fillStyle = g;
    }
    ctx.fillRect(0, 0, W, H);
    for (const it of pg.items) drawItem(ctx, it, W, H, local, length, animated);
    ctx.restore();
  }
  function video(ctx, p, t, W, H) {
    const schedule = M.schedule(p),
      index = schedule.findIndex((c) => t >= c.start && t < c.end);
    const c =
      index >= 0
        ? schedule[index]
        : t >= M.duration(p)
          ? schedule.at(-1)
          : null;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
    if (c) {
      const pg = p.pages.find((pg) => pg.id === c.pageId),
        local = Math.min(c.duration - 1e-6, t - c.start),
        fade = Math.min(0.6, c.duration / 2);
      if (index > 0 && c.transition === 'fade' && local < fade) {
        const prev = schedule[index - 1],
          prevPage = p.pages.find((pg) => pg.id === prev.pageId);
        page(
          ctx,
          p,
          prevPage,
          W,
          H,
          Math.max(0, prev.duration - fade + local),
          prev.duration,
          true,
        );
        ctx.save();
        ctx.globalAlpha = local / fade;
        page(ctx, p, pg, W, H, local, c.duration, true);
        ctx.restore();
      } else page(ctx, p, pg, W, H, Math.max(0, local), c.duration, true);
    }
    const activeCues = p.captions.filter(
      (cue) => t >= cue.start && t < cue.end,
    );
    for (const [index, cue] of activeCues.entries()) {
      const s = M.captionStyle(p, cue),
        it = {
          ...M.item(),
          text: cue.text,
          font: s.font,
          size: s.size,
          color: s.color,
          color2: s.color2,
          highlight: s.highlight,
          gradient: s.gradient,
          effect: s.effect,
          effectAmount: s.effectAmount,
          stroke: s.stroke,
          strokeWidth: s.strokeWidth,
          weight: s.weight,
          italic: s.italic,
          align: s.align,
          tracking: s.tracking,
          shadow: s.shadow || (s.preset === 'glow' ? 30 : 0),
          shadowColor:
            s.preset === 'glow' && !s.shadow ? s.highlight : s.shadowColor,
          panel: s.panel || s.preset === 'box',
          panelColor: s.panelColor,
          panelOpacity: s.panelOpacity,
          lineHeight: s.lineHeight,
          enter: s.enter || 'none',
          exit: s.exit || 'none',
          animDuration: s.animDuration || 0.3,
        };
      const box = M.captionBox(p, cue, index),
        w = W * box.w,
        h = H * box.h;
      ctx.save();
      const motionState = motion(it, t - cue.start, cue.end - cue.start);
      ctx.globalAlpha *= motionState.alpha * s.opacity;
      ctx.translate(
        W * box.x + w / 2 + motionState.dx * W,
        H * box.y + h / 2 + motionState.dy * H,
      );
      motionTransform(ctx, motionState, w, h, H);
      const q = (t - cue.start) / (cue.end - cue.start);
      drawText(
        ctx,
        it,
        w,
        h,
        H,
        Math.min(s.preset === 'typewriter' ? q : 1, motionState.reveal),
        s.preset === 'karaoke' ? q : -1,
      );
      ctx.restore();
    }
  }
  return {
    createRenderer,
    itemPreview,
    prepare,
    page,
    video,
    motion,
    lines,
    font,
    drawText,
  };
})();

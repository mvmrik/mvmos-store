/*
 * Remember the Pairs — the pictures.
 *
 * One place draws every card, for both views: the flat table shows the result
 * as an image, the 3D cylinder wraps the very same canvas around a card. A theme
 * is a list of things to draw; the server only decides *which* of them are on
 * the table (picks) and which card is which (the deck).
 *
 * Emoji themes are drawn with the device's own emoji font, so they cost
 * nothing to ship. Numbers, colours and shapes are drawn here.
 */
(function () {
  'use strict';

  const E = s => s.split(' ').filter(Boolean);
  // VS16 makes sure text-default symbols are drawn as pictures.
  const EMOJI = {
    animals: E('🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🦂 🐢 🐍 🦎 🐙 🦑 🦐 🦀 🐡 🐠 🐟 🐬 🐳 🦈 🐊 🐅 🐆 🦓 🦍 🐘 🦛 🦏 🐪 🦒 🦘 🐃 🐿 🦔'),
    food: E('🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥒 🌽 🥕 🥔 🍠 🥐 🍞 🥖 🥨 🧀 🥚 🍳 🥞 🥓 🥩 🍗 🌭 🍔 🍟 🍕 🥪 🌮 🥗 🍝 🍜 🍣 🍱 🍤 🍙 🍦 🍩 🍪 🎂 🍰 🍫 🍬 🍭 🍿 🍯 🥛 ☕'),
    nature: E('🌵 🎄 🌲 🌳 🌴 🌱 🌿 🍀 🍁 🍂 🍄 🌾 💐 🌷 🌹 🌺 🌸 🌼 🌻 🌞 🌝 🌛 ⭐ 🌟 ☁ ⛅ 🌈 ⚡ ❄ 🔥 💧 🌊 🌋 🏔 🌍 🌙 ☀ ☔ ⛄ 🌪 🌸 🪨 🐚 🪵 🌰 🍃 🥀 🌠 🌅 🏝'),
    travel: E('🚗 🚕 🚙 🚌 🚎 🏎 🚓 🚑 🚒 🚐 🚚 🚛 🚜 🛵 🏍 🚲 🛴 🚂 🚆 🚇 🚊 🚁 ✈ 🛩 🚀 🛸 ⛵ 🚤 🛥 🚢 ⚓ 🚡 🚠 🚟 🛶 🚏 🚦 ⛽ 🎡 🎢 🎠 🏰 🗼 🗽 🗿 ⛺ 🏠 🚔 🛻 🛺'),
    fun: E('⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🏸 🥊 ⛳ 🎯 🎳 🎲 🧩 🎮 🎸 🎹 🥁 🎺 🎻 🎤 🎧 🎨 🎬 🎭 🎪 🏆 🥇 🎁 🎈 🎉 🔮 🎷 🪁 🛹 🎿 🏹 🪀 🎰 🃏 🎼 🏅 🧸 🪄 🎣 🎖 🎙'),
    faces: E('😀 😃 😄 😁 😆 😅 😂 🙂 😉 😊 😇 😍 🥰 😘 😋 😛 😜 🤪 🤗 🤔 😎 🤓 🥳 😏 😴 😭 😡 🥶 🥵 😱 🤯 😷 🤠 🤡 👻 👽 🤖 💀 😈 😺 😻 🙈 🙉 🙊 🤤 😇 😬 🤩 😌 😐')
  };
  // The same picture twice in a list would make an impossible pair.
  Object.keys(EMOJI).forEach(k => { EMOJI[k] = Array.from(new Set(EMOJI[k])); });

  // Per-theme card back colour (hue).
  const BACK_HUE = { animals: 28, food: 350, nature: 140, travel: 205, fun: 270, faces: 48, numbers: 222, colors: 320, shapes: 175 };

  const COLORS = (() => {
    const out = [];
    for (let h = 0; h < 360; h += 30) out.push('hsl(' + h + ',72%,48%)');
    for (let h = 15; h < 360; h += 30) out.push('hsl(' + h + ',90%,76%)');
    return out;
  })();
  const SHAPE_COLORS = ['#e5484d', '#3b82f6', '#22a559', '#f2b705', '#8b5cf6', '#f97316'];
  const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'star', 'heart', 'hexagon', 'pentagon', 'plus', 'moon'];

  const SIZE = { w: 192, h: 256 };
  const FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function polygon(g, cx, cy, r, n, rot) {
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = rot + i * Math.PI * 2 / n;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
  }

  function drawShape(g, name, cx, cy, r, color) {
    g.fillStyle = color;
    g.strokeStyle = 'rgba(0,0,0,.28)';
    g.lineWidth = 5;
    g.lineJoin = 'round';
    switch (name) {
      case 'circle': g.beginPath(); g.arc(cx, cy, r, 0, 7); break;
      case 'square': roundRect(g, cx - r * .86, cy - r * .86, r * 1.72, r * 1.72, r * .16); break;
      case 'triangle': polygon(g, cx, cy + r * .1, r * 1.1, 3, -Math.PI / 2); break;
      case 'diamond': polygon(g, cx, cy, r * 1.1, 4, 0); break;
      case 'hexagon': polygon(g, cx, cy, r, 6, 0); break;
      case 'pentagon': polygon(g, cx, cy + r * .05, r * 1.05, 5, -Math.PI / 2); break;
      case 'star': {
        g.beginPath();
        for (let i = 0; i < 10; i++) {
          const rr = i % 2 ? r * .46 : r * 1.1, a = -Math.PI / 2 + i * Math.PI / 5;
          const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.closePath();
        break;
      }
      case 'heart':
        g.beginPath();
        g.moveTo(cx, cy + r * .95);
        g.bezierCurveTo(cx - r * 1.5, cy - r * .1, cx - r * .8, cy - r * 1.1, cx, cy - r * .35);
        g.bezierCurveTo(cx + r * .8, cy - r * 1.1, cx + r * 1.5, cy - r * .1, cx, cy + r * .95);
        g.closePath();
        break;
      case 'plus': {
        const t = r * .42;
        g.beginPath();
        g.rect(cx - t, cy - r, t * 2, r * 2);
        g.rect(cx - r, cy - t, r * 2, t * 2);
        g.fill(); g.stroke();
        return;
      }
      case 'moon':
        g.beginPath();
        g.arc(cx, cy, r, Math.PI * .28, Math.PI * 1.72, false);
        g.arc(cx + r * .42, cy, r * .78, Math.PI * 1.6, Math.PI * .4, true);
        g.closePath();
        break;
    }
    g.fill(); g.stroke();
  }

  // How many different pictures a theme has.
  function count(theme) {
    if (EMOJI[theme]) return EMOJI[theme].length;
    return { numbers: 99, colors: COLORS.length, shapes: SHAPES.length * SHAPE_COLORS.length }[theme] || 0;
  }

  // Picture `k` of the theme, as a card face.
  function face(theme, k) {
    const c = document.createElement('canvas');
    c.width = SIZE.w; c.height = SIZE.h;
    const g = c.getContext('2d');
    const W = SIZE.w, H = SIZE.h, cx = W / 2, cy = H / 2;
    const hue = (k * 47 + 20) % 360;
    // Paper
    roundRect(g, 3, 3, W - 6, H - 6, 22);
    const bg = g.createLinearGradient(0, 0, 0, H);
    if (theme === 'numbers') { bg.addColorStop(0, 'hsl(' + hue + ',70%,60%)'); bg.addColorStop(1, 'hsl(' + hue + ',70%,40%)'); }
    else if (theme === 'colors') { bg.addColorStop(0, '#fbfaf6'); bg.addColorStop(1, '#ebe8df'); }
    else { bg.addColorStop(0, 'hsl(' + hue + ',70%,96%)'); bg.addColorStop(1, 'hsl(' + hue + ',55%,86%)'); }
    g.fillStyle = bg; g.fill();
    g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.25)'; g.stroke();

    if (EMOJI[theme]) {
      const ch = EMOJI[theme][k % EMOJI[theme].length] + '️';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = Math.round(W * .62) + 'px ' + FONT;
      g.shadowColor = 'rgba(0,0,0,.25)'; g.shadowBlur = 10; g.shadowOffsetY = 5;
      g.fillText(ch, cx, cy + 6);
      g.shadowColor = 'transparent';
    } else if (theme === 'numbers') {
      const n = (k % 99) + 1;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#fff';
      g.font = '800 ' + Math.round(W * (n > 9 ? .6 : .78)) + 'px system-ui,"Segoe UI",Arial,sans-serif';
      g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 8; g.shadowOffsetY = 5;
      g.fillText(String(n), cx, cy + 8);
      g.shadowColor = 'transparent';
      g.font = '700 28px system-ui,Arial,sans-serif';
      g.fillText(String(n), 30, 34); g.fillText(String(n), W - 30, H - 34);
    } else if (theme === 'colors') {
      const col = COLORS[k % COLORS.length];
      roundRect(g, 22, 30, W - 44, H - 60, 18);
      g.fillStyle = col; g.fill();
      g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,.3)'; g.stroke();
      const gl = g.createLinearGradient(0, 30, 0, H * .55);
      gl.addColorStop(0, 'rgba(255,255,255,.45)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
      roundRect(g, 22, 30, W - 44, H - 60, 18); g.fillStyle = gl; g.fill();
    } else if (theme === 'shapes') {
      drawShape(g, SHAPES[k % SHAPES.length], cx, cy, W * .3, SHAPE_COLORS[Math.floor(k / SHAPES.length) % SHAPE_COLORS.length]);
    }
    return c;
  }

  // The back of every card of a theme.
  function back(theme) {
    const c = document.createElement('canvas');
    c.width = SIZE.w; c.height = SIZE.h;
    const g = c.getContext('2d');
    const W = SIZE.w, H = SIZE.h, h = BACK_HUE[theme] != null ? BACK_HUE[theme] : 220;
    roundRect(g, 3, 3, W - 6, H - 6, 22);
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, 'hsl(' + h + ',62%,46%)'); bg.addColorStop(1, 'hsl(' + ((h + 28) % 360) + ',66%,28%)');
    g.fillStyle = bg; g.fill();
    g.save();
    roundRect(g, 3, 3, W - 6, H - 6, 22); g.clip();
    g.strokeStyle = 'rgba(255,255,255,.16)'; g.lineWidth = 3;
    for (let i = -H; i < W + H; i += 34) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + H, H); g.stroke();
      g.beginPath(); g.moveTo(i + H, 0); g.lineTo(i, H); g.stroke();
    }
    g.restore();
    roundRect(g, 16, 16, W - 32, H - 32, 14);
    g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 4; g.stroke();
    g.beginPath(); g.arc(W / 2, H / 2, 40, 0, 7);
    g.fillStyle = 'rgba(255,255,255,.92)'; g.fill();
    g.fillStyle = 'hsl(' + h + ',62%,34%)';
    g.font = '800 56px system-ui,Arial,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('?', W / 2, H / 2 + 3);
    g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.3)'; roundRect(g, 3, 3, W - 6, H - 6, 22); g.stroke();
    return c;
  }

  const _faceURL = {}, _backURL = {};
  window.MPFaces = {
    SIZE, count, face, back, BACK_HUE,
    faceURL(theme, k) { const key = theme + ':' + k; return _faceURL[key] || (_faceURL[key] = face(theme, k).toDataURL()); },
    backURL(theme) { return _backURL[theme] || (_backURL[theme] = back(theme).toDataURL()); }
  };
})();

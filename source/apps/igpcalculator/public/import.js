// Reads rendered iGP pages supplied by the Apps Hub extension. No scripts
// from those pages are executed and no session fields or raw HTML are saved.
(function () {
  'use strict';
  const TYRES = ['SS', 'S', 'M', 'H', 'I', 'W'];
  const FLAGS = { ae: 'abu_dhabi', au: 'australia', at: 'austria', az: 'azerbaijan', bh: 'bahrain', be: 'belgium', br: 'brazil', ca: 'canada', cn: 'china', eu: 'europe', fr: 'france', de: 'germany', gb: 'great_britain', hu: 'hungary', it: 'italy', jp: 'japan', my: 'malaysia', mx: 'mexico', mc: 'monaco', nl: 'netherlands', ru: 'russia', sg: 'singapore', es: 'spain', tr: 'turkey', us: 'usa' };
  const text = el => el ? el.textContent.replace(/\uFEFF/g, '').replace(/\s+/g, ' ').trim() : '';
  const number = value => {
    const m = /-?\d+(?:[.,]\d+)?/.exec(String(value ?? ''));
    return m ? Number(m[0].replace(',', '.')) : null;
  };
  const flag = el => /(?:^|\s)f-([a-z]{2})(?:\s|$)/.exec(el?.className || '')?.[1] || '';
  function route(href, base) {
    try {
      const u = new URL(href, base || 'https://igpmanager.com/app/');
      if (!/(^|\.)igpmanager\.com$/.test(u.hostname) || !/^https?:$/.test(u.protocol)) return null;
      const params = new URLSearchParams(u.pathname.replace(/^\/app\//, '') + '&' + u.search.slice(1));
      return { path: u.pathname + u.search, p: params.get('p'), d: params.get('d'), id: number(params.get('id')), raceId: number(params.get('raceId')) };
    } catch (_) { return null; }
  }
  function documentOf(page) {
    if (!page || typeof page.html !== 'string' || !route(page.url)) return null;
    return new DOMParser().parseFromString(page.html, 'text/html');
  }
  function time(value) {
    const m = /^(?:(\d+):)?(\d{1,2}):(\d{2}(?:[.,]\d+)?)$/.exec(String(value).trim());
    return m ? +(Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3].replace(',', '.'))).toFixed(3) : null;
  }
  function date(value) {
    const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(value);
    if (iso) return iso[0];
    // Month names are matched in all app languages, not by translated labels.
    for (const lang of ['en', 'bg', 'de', 'es', 'fr', 'ja', 'pt-BR', 'ru', 'zh-CN']) {
      for (let i = 0; i < 12; i++) {
        const name = new Intl.DateTimeFormat(lang, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, i, 15))).replace(/\.$/, '');
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const m = new RegExp('(\\d{1,2})\\s+' + escaped + '\\.?[ ,]+(20\\d{2})', 'i').exec(value);
        if (m) return m[2] + '-' + String(i + 1).padStart(2, '0') + '-' + m[1].padStart(2, '0');
      }
    }
    return '';
  }
  function trackFrom(el) {
    return FLAGS[flag(el?.querySelector('.flag'))] || '';
  }
  function nextDate(value, now = new Date()) {
    const explicit = date(value);
    if (explicit) return explicit;
    const normalized = value.normalize('NFKC').toLocaleLowerCase().trim();
    const weekdays = new Map();
    for (const lang of ['en', 'bg', 'de', 'es', 'fr', 'ja', 'pt-BR', 'ru', 'zh-CN']) {
      for (let day = 0; day < 7; day++) {
        for (const weekday of ['long', 'short']) {
          const name = new Intl.DateTimeFormat(lang, { weekday, timeZone: 'UTC' })
            .format(new Date(Date.UTC(2026, 8, 27 + day))).normalize('NFKC').toLocaleLowerCase().replace(/\.$/, '');
          weekdays.set(name, day);
        }
      }
    }
    const match = [...weekdays].sort((a, b) => b[0].length - a[0].length).find(([name]) =>
      normalized.startsWith(name) && !/[\p{L}\p{N}]/u.test(normalized.slice(name.length, name.length + 1)));
    const clock = /\b(\d{1,2}):(\d{2})\b/.exec(normalized);
    if (!match || !clock || +clock[1] > 23 || +clock[2] > 59) return '';
    // iGP renders the schedule in the viewing browser's local time. Use the
    // same local calendar, including month/year changes and daylight saving.
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +clock[1], +clock[2]);
    const days = (match[1] - now.getDay() + 7) % 7;
    target.setDate(target.getDate() + days);
    if (target < now) target.setDate(target.getDate() + 7);
    return target.getFullYear() + '-' + String(target.getMonth() + 1).padStart(2, '0') + '-' + String(target.getDate()).padStart(2, '0');
  }
  function currentDrivers(page) {
    const doc = documentOf(page);
    if (!doc) return [];
    return [1, 2].map(car => {
      const box = doc.querySelector('#drivers #d' + car + 'Pic');
      const link = route(box?.querySelector('a[href]')?.getAttribute('href'), page.url);
      const name = box?.querySelector('.driverName')?.cloneNode(true);
      name?.querySelectorAll('br').forEach(br => br.replaceWith(' '));
      return link?.d === 'driver' && link.id ? { igp_id: link.id, name: text(name), car, path: link.path } : null;
    }).filter(Boolean);
  }
  function driver(page, seed) {
    const doc = documentOf(page);
    if (!doc?.querySelector('#driverNameFirst')) return seed;
    const source = route(page.url);
    // A dialog belonging to someone else must not overwrite the requested driver.
    const chatLink = doc.querySelector('#driverChatBtn')?.getAttribute('href') || '';
    const id = number(/(?:driver|eId)=(\d+)/.exec(chatLink)?.[1]) || (source?.d === 'driver' ? source.id : null);
    if (id !== seed.igp_id) return seed;
    const out = { ...seed, name: [text(doc.querySelector('#driverNameFirst')), text(doc.querySelector('#driverNameLast'))].join(' ').trim() };
    const head = doc.querySelector('.dialog-subhead-content');
    out.country = flag(head?.querySelector('.flag')).toUpperCase();
    const cell = [...doc.querySelectorAll('#stats .attribute-cell')].find(el => el.querySelector('use')?.getAttribute('xlink:href')?.endsWith('#talent'));
    out.talent = number(text(cell?.querySelector('.attribute-cell-value')));
    const ability = head?.querySelector('[class*="specialA"]');
    if (ability) {
      // Rarity is structural; the ability label is retained only when known.
      out.tier = ['common', 'rare', 'legendary'][number(/specialA(\d)/.exec(ability.className)?.[1]) - 1] || 'common';
      const names = { racecraft: 'racecraft', qualifying: 'qualifying', 'street circuits': 'street', 'wet weather': 'wet' };
      if (names[text(ability).toLowerCase()]) out.ability = names[text(ability).toLowerCase()];
    }
    const favourite = [...(head?.querySelectorAll('span') || [])].find(el => el.classList.contains('font-heading') && !el.id);
    const normalized = text(favourite).toLowerCase().replace(/\s+/g, '_');
    if (Object.values(FLAGS).includes(normalized)) out.fav_track = normalized;
    return out;
  }
  function nextRace(page, seats) {
    const doc = documentOf(page);
    if (!doc?.querySelector('#d1setup')) return null;
    const id = number(doc.querySelector('#d1setup input[name="race"]')?.getAttribute('value'));
    const track = trackFrom(doc.querySelector('.raceHeadTitle'));
    const laps = number(text(doc.querySelector('#raceLaps')));
    if (!id || !track || !laps) return null;
    const map = { tyre: 'tyre', fwing: 'fw', rwing: 'rw', gear: 'gear', camber: 'camber', suspension: 'susp', ride: 'ride', brake: 'brake', toe: 'toe' };
    const cars = [1, 2].map(car => {
      const form = doc.querySelector('#d' + car + 'setup');
      const seat = seats.find(d => d.car === car);
      if (!form || !seat) return null;
      const setup = {};
      form.querySelectorAll('input.setupSlider-input').forEach(el => {
        const key = map[el.name], v = number(el.getAttribute('value'));
        if (!key || v == null) return;
        const min = number(el.getAttribute('data-display-min'));
        const step = number(el.getAttribute('data-display-step'));
        if (min == null || !(step > 0)) return;
        setup[key] = +((min + v * step) * (el.getAttribute('data-display-negate') === '1' ? -1 : 1)).toFixed(3);
      });
      const practice = [...doc.querySelectorAll('#d' + car + 'Laps > table > tbody > tr')].map(row => {
        const cells = [...row.children];
        const tyre = /(?:^|\s)ts-(SS|S|M|H|I|W)(?:\s|$)/.exec(cells[0]?.className || '')?.[1];
        if (!tyre || cells.length !== 7) return null;
        return { lap: number(text(cells[0])), tyre, setup: { ride: number(text(cells[1])), susp: number(text(cells[2])), wing: number(text(cells[3])) },
          fuel: Math.abs(number(text(cells[4])) || 0), wear: Math.abs(number(text(cells[5])) || 0), time: time(text(cells[6])) };
      }).filter(p => p?.lap > 0).sort((a, b) => a.lap - b.lap);
      const tyres = {};
      practice.forEach(p => { tyres[p.tyre] = { fuel: p.fuel || null, wear: p.wear || null, time: p.time }; });
      return { igpDriverId: seat.igp_id, driverName: seat.name, setup, tyres, practice };
    }).filter(Boolean);
    if (!cars.length) return null;
    // The rendered schedule may contain a weekday and time instead of a date.
    const start = text(doc.querySelector('.raceInfoPrimary'));
    return { igpRaceId: id, track, race_date: nextDate(start), start, laps, cars, kind: 'next' };
  }
  function results(page) {
    const doc = documentOf(page);
    if (!doc?.querySelector('#csvRace')) return null;
    const id = number(doc.querySelector('[data-csvtable="csvRace"]')?.getAttribute('data-csvname'));
    const track = trackFrom(doc.querySelector('.resultDialog .dialog-head'));
    if (!id || !track) return null;
    const cars = [...doc.querySelectorAll('#csvRace > tbody > tr.myTeam')].map(row => {
      const cells = [...row.children];
      const link = [...row.querySelectorAll('a[href]')].map(a => route(a.getAttribute('href'), page.url));
      const d = link.find(r => r?.d === 'driver'), detail = link.find(r => r?.d === 'resultDetail');
      if (!d?.id || !detail) return null;
      const name = cells[1].cloneNode(true);
      name.querySelectorAll('.teamName').forEach(el => el.remove());
      const finish = text(cells[2]);
      const behind = /^\+\s*(\d+)\s*[^\d:.,\s]/.exec(finish);
      return { igpDriverId: d.id, driverName: text(name), country: flag(cells[1].querySelector('.flag')).toUpperCase(), path: detail.path, position: number(text(cells[0])), finish, lapsBehind: behind ? Number(behind[1]) : null, bestLap: time(text(cells[3])), pits: number(text(cells[5])) };
    }).filter(Boolean);
    const posted = [...doc.querySelectorAll('.resultDialog .notice')].map(text).map(date).find(Boolean) || '';
    return { igpRaceId: id, track, race_date: posted, cars, kind: 'previous' };
  }
  function tyreName(value) {
    const v = value.toLowerCase().trim();
    if (TYRES.includes(value.trim())) return value.trim();
    const words = { SS: ['super soft', 'superweich', 'супермеки', 'супермяг', 'superbland', 'super tendre', 'supermacio', 'スーパーソフト', '超软'], S: ['soft', 'weich', 'меки', 'мягк', 'bland', 'tendre', 'macio', 'ソフト', '软'], M: ['medium', 'mittel', 'средн', 'medi', 'moyen', 'médio', 'ミディアム', '中性'], H: ['hard', 'hart', 'твърд', 'жестк', 'dura', 'dur', 'duro', 'ハード', '硬'], I: ['intermediate', 'intermedi', 'междин', 'промежуточ', 'インターミディエイト', '半雨'], W: ['full wet', 'wet', 'regenreifen', 'дъжд', 'дожд', 'lluvia', 'pluie', 'chuva', 'ウェット', '全雨'] };
    return TYRES.find(t => words[t].some(w => v.includes(w))) || null;
  }
  function detail(page, race, car) {
    const doc = documentOf(page), source = route(page?.url), expected = route(car.path);
    if (!doc?.querySelector('#csvRaceResult') || source?.d !== 'resultDetail' || source.id !== expected?.id) return null;
    const csv = doc.querySelector('[data-csvtable="csvRaceResult"]')?.getAttribute('data-csvname') || '';
    if (number(csv.split('_')[0]) !== race.igpRaceId) return null;
    const stints = [], report = [];
    let tyre = null, startFuel = null, last = null, invalid = false;
    for (const row of doc.querySelectorAll('#csvRaceResult > tbody > tr')) {
      const cells = [...row.children];
      if (row.classList.contains('pit')) {
        if (last) { stints.push({ tyre, lap: last.lap, left: last.left, fuel: last.fuel }); last = null; }
        const labels = cells[1]?.querySelectorAll('span.green') || [];
        tyre = tyreName(text(labels[labels.length - 1]));
        if (!tyre) invalid = true;
        if (startFuel == null) {
          const after = text(cells[1]).split('/').pop();
          startFuel = number(after);
        }
      } else if (cells.length === 7) {
        const lap = number(text(cells[0]));
        if (!(lap > 0)) continue;
        last = { lap, time: time(text(cells[1])), position: number(text(cells[4])), tyre, left: number(text(cells[5])), fuel: number(text(cells[6])) };
        report.push(last);
      }
    }
    if (last) stints.push({ tyre, lap: last.lap, left: last.left, fuel: last.fuel });
    if (invalid || !stints.length || startFuel == null || stints.length !== car.pits + 1) return null;
    // Missing laps at the finish are not padded to the winner's distance.
    return { ...car, actual: { startFuel, stints }, report, igpResultId: expected.id };
  }
  function paths(page) {
    const doc = documentOf(page);
    if (!doc) return {};
    const menu = id => {
      const value = doc.querySelector('#' + id)?.getAttribute('data-link');
      return value ? route('/app/' + value, page.url)?.path : null;
    };
    const next = [...doc.querySelectorAll('a[href]')].map(a => route(a.getAttribute('href'), page.url)).find(r => r?.p === 'race');
    return { home: menu('mRace'), staff: menu('mStaff'), next: next?.path, previous: route(doc.querySelector('#homeLeagueResultBtn')?.getAttribute('href'), page.url)?.path };
  }
  async function collect(extension, progress) {
    const warnings = [];
    let expected = 4;
    async function read(path, validate, label, info) {
      progress({ label, path, info, state: 'reading', expected });
      for (let i = 0; i < 2; i++) {
        const pages = await extension.readPages([path]);
        if (!pages) break;
        const page = pages[0];
        if (documentOf(page) && (!validate || validate(page))) { progress({ label, path, info, state: 'ok', expected }); return page; }
      }
      warnings.push(label);
      progress({ label, path, info, state: 'failed', expected });
      return null;
    }
    const here = await extension.readPage();
    if (!documentOf(here)) throw new Error('page');
    const nav = paths(here);
    const home = nav.previous && nav.next ? here : await read(nav.home || '/app/p=home', p => !!paths(p).previous || !!paths(p).next, 'igp_import_home');
    const links = { ...nav, ...paths(home) };
    const staff = currentDrivers(here).length ? here : await read(links.staff || '/app/p=staff', p => currentDrivers(p).length > 0, 'igp_drivers');
    const seats = currentDrivers(staff);
    const drivers = seats.slice();
    expected += drivers.length;
    const upcomingPage = nextRace(here, seats) ? here : await read(links.next || '/app/p=race', p => !!nextRace(p, seats), 'igp_import_next');
    const next = nextRace(upcomingPage, seats);
    const resultPage = results(here) ? here : links.previous ? await read(links.previous, p => !!results(p), 'igp_import_previous') : null;
    const previous = results(resultPage);
    if (previous) {
      expected += previous.cars.length;
      for (const car of previous.cars) {
        if (!drivers.some(d => d.igp_id === car.igpDriverId)) expected++, drivers.push({ igp_id: car.igpDriverId, name: car.driverName, country: car.country, path: '/app/d=driver&id=' + car.igpDriverId });
      }
    }
    for (let i = 0; i < drivers.length; i++) {
      const seed = drivers[i];
      const opened = driver(here, seed);
      const page = opened !== seed ? here : await read(seed.path, p => driver(p, seed) !== seed, 'igp_driver', seed.name);
      drivers[i] = driver(page, seed);
    }
    if (previous) {
      const cars = [];
      for (const car of previous.cars) {
        const already = detail(here, previous, car);
        const page = already ? here : await read(car.path, p => !!detail(p, previous, car), 'igp_actual', car.driverName);
        const found = detail(page, previous, car);
        if (found) cars.push(found);
      }
      previous.cars = cars;
      // Completed laps plus the published deficit give the winner's distance.
      // A retired driver or a missing deficit never supplies a guessed distance.
      const distances = cars.filter(c => c.lapsBehind != null).map(c => c.report[c.report.length - 1].lap + c.lapsBehind);
      previous.laps = distances.length && distances.every(n => n === distances[0]) ? distances[0] : null;
    }
    for (const race of [next, previous].filter(Boolean)) {
      race.cars.forEach(car => { car.driverName = drivers.find(d => d.igp_id === car.igpDriverId)?.name || car.driverName; });
    }
    return { drivers, races: [next, previous].filter(r => r?.cars.length), warnings };
  }
  window.IGPImport = { currentDrivers, driver, nextRace, results, detail, paths, collect, time, nextDate };
})();

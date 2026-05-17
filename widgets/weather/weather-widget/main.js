const _ww18n = {
  en: {
    label:    'Weather',
    loading:  'Loading…',
    error:    'Could not load weather',
    no_city:  'Set city in settings',
    wind:     'Wind',
    humidity: 'Humidity',
    feels:    'Feels like',
    rain:     'Rain chance',
    hourly:   'Next hours',
    forecast: '5-day forecast',
    uv:       'UV',
    gust:     'Gusts',
    sunrise:  'Sunrise',
    sunset:   'Sunset',
  },
  bg: {
    label:    'Времето',
    loading:  'Зарежда…',
    error:    'Неуспешно зареждане',
    no_city:  'Задайте град в настройките',
    wind:     'Вятър',
    humidity: 'Влажност',
    feels:    'Усеща се като',
    rain:     'Шанс за дъжд',
    hourly:   'Следващи часове',
    forecast: 'Прогноза 5 дни',
    uv:       'UV',
    gust:     'Пориви',
    sunrise:  'Изгрев',
    sunset:   'Залез',
  },
};
function _wwt(key) {
  const lang = window.mvmOS?.lang || 'en';
  return (_ww18n[lang] || _ww18n.en)[key] || key;
}

const WMO_CODES = {
  0:  ['☀️',  'Clear sky'],       1:  ['🌤️', 'Mainly clear'],
  2:  ['⛅',  'Partly cloudy'],    3:  ['☁️',  'Overcast'],
  45: ['🌫️', 'Foggy'],            48: ['🌫️', 'Icy fog'],
  51: ['🌦️', 'Light drizzle'],    53: ['🌦️', 'Drizzle'],
  55: ['🌧️', 'Heavy drizzle'],    61: ['🌧️', 'Light rain'],
  63: ['🌧️', 'Rain'],             65: ['🌧️', 'Heavy rain'],
  71: ['🌨️', 'Light snow'],       73: ['🌨️', 'Snow'],
  75: ['❄️',  'Heavy snow'],       77: ['🌨️', 'Snow grains'],
  80: ['🌦️', 'Light showers'],    81: ['🌧️', 'Showers'],
  82: ['⛈️',  'Heavy showers'],    85: ['🌨️', 'Snow showers'],
  86: ['❄️',  'Heavy snow showers'], 95: ['⛈️', 'Thunderstorm'],
  96: ['⛈️',  'Thunderstorm + hail'], 99: ['⛈️', 'Thunderstorm + heavy hail'],
};
function _wmoIcon(code) { return (WMO_CODES[code] || ['🌡️', ''])[0]; }
function _wmoDesc(code) { return (WMO_CODES[code] || ['', 'Unknown'])[1]; }

async function _geocode(city, country) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=10&language=en&format=json`;
  const res = await fetch(url);
  const j = await res.json();
  if (!j.results?.length) throw new Error('City not found');
  const cc = (country || '').toUpperCase();
  const match = cc ? j.results.find(r => r.country_code === cc) : null;
  const r = match || j.results[0];
  return { lat: r.latitude, lon: r.longitude, name: r.name, country: r.country_code };
}

async function _fetchOpenMeteo(lat, lon, units, size) {
  const u = units === 'fahrenheit' ? 'fahrenheit' : 'celsius';
  const sym = units === 'fahrenheit' ? '°F' : '°C';
  const toT = v => Math.round(v) + sym;

  let url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,uv_index,precipitation_probability`
    + `&temperature_unit=${u}&wind_speed_unit=kmh&timezone=auto`;

  if (size === 'l') {
    url += `&hourly=temperature_2m,weather_code,precipitation_probability,wind_speed_10m&forecast_hours=12`
         + `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset&forecast_days=5`;
  }

  const res = await fetch(url);
  const j = await res.json();
  const c = j.current;

  const current = {
    icon:     _wmoIcon(c.weather_code),
    desc:     _wmoDesc(c.weather_code),
    temp:     toT(c.temperature_2m),
    feels:    toT(c.apparent_temperature),
    wind:     Math.round(c.wind_speed_10m) + ' km/h',
    gust:     Math.round(c.wind_gusts_10m || 0) + ' km/h',
    humidity: c.relative_humidity_2m + '%',
    uv:       c.uv_index ?? '—',
    rain:     (c.precipitation_probability ?? '—') + (c.precipitation_probability != null ? '%' : ''),
  };

  let hourly = [], daily = [];

  if (size === 'l' && j.hourly) {
    const now = new Date();
    const h = j.hourly;
    for (let i = 0; i < h.time.length && hourly.length < 6; i++) {
      const t = new Date(h.time[i]);
      if (t < now) continue;
      hourly.push({
        time: t.getHours().toString().padStart(2,'0') + ':00',
        icon: _wmoIcon(h.weather_code[i]),
        temp: toT(h.temperature_2m[i]),
        rain: (h.precipitation_probability[i] ?? 0) + '%',
        wind: Math.round(h.wind_speed_10m[i]) + ' km/h',
      });
    }
    if (j.daily) {
      const d = j.daily;
      const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      for (let i = 0; i < d.time.length; i++) {
        const dt = new Date(d.time[i]);
        daily.push({
          day:     days[dt.getDay()],
          icon:    _wmoIcon(d.weather_code[i]),
          max:     toT(d.temperature_2m_max[i]),
          min:     toT(d.temperature_2m_min[i]),
          rain:    (d.precipitation_probability_max[i] ?? 0) + '%',
          wind:    Math.round(d.wind_speed_10m_max[i]) + ' km/h',
          sunrise: d.sunrise[i]?.slice(11,16) || '',
          sunset:  d.sunset[i]?.slice(11,16) || '',
        });
      }
    }
  }

  return { current, hourly, daily };
}

async function _fetchWttr(city, country, units) {
  const q = country ? `${city},${country}` : city;
  const res = await fetch(`https://wttr.in/${encodeURIComponent(q)}?format=j1`);
  const j = await res.json();
  const c = j.current_condition[0];
  const isFahr = units === 'fahrenheit';
  const sym = isFahr ? '°F' : '°C';
  const current = {
    icon:     _wmoIcon(parseInt(c.weatherCode)),
    desc:     c.weatherDesc?.[0]?.value || '',
    temp:     (isFahr ? c.temp_F : c.temp_C) + sym,
    feels:    (isFahr ? c.FeelsLikeF : c.FeelsLikeC) + sym,
    wind:     c.windspeedKmph + ' km/h',
    gust:     '—',
    humidity: c.humidity + '%',
    uv:       c.uvIndex ?? '—',
    rain:     c.precipMM ? c.precipMM + 'mm' : '—',
  };
  return { current, hourly: [], daily: [] };
}

// ── Render helpers ────────────────────────────────────────────────────────────
function _renderS(container, data, cityLabel) {
  const { current: d } = data;
  container.innerHTML = `
    <div class="ww-wrap ww-s">
      <div class="ww-header">
        <div class="ww-city">${cityLabel}</div>
        <div class="ww-main">
          <div class="ww-icon">${d.icon}</div>
          <div class="ww-temp-block">
            <div class="ww-temp">${d.temp}</div>
            <div class="ww-desc">${d.desc}</div>
          </div>
        </div>
      </div>
    </div>`;
}

function _renderM(container, data, cityLabel, provider) {
  const { current: d } = data;
  container.innerHTML = `
    <div class="ww-wrap ww-m">
      <div class="ww-header">
        <div class="ww-city">${cityLabel}</div>
        <div class="ww-main">
          <div class="ww-icon">${d.icon}</div>
          <div class="ww-temp-block">
            <div class="ww-temp">${d.temp}</div>
            <div class="ww-desc">${d.desc}</div>
          </div>
        </div>
      </div>
      <div class="ww-body">
        ${d.feels !== '—' ? `<div class="ww-row"><span class="ww-row-label">🌡️ ${_wwt('feels')}</span><span class="ww-row-val">${d.feels}</span></div>` : ''}
        <div class="ww-row"><span class="ww-row-label">💨 ${_wwt('wind')}</span><span class="ww-row-val">${d.wind}</span></div>
        ${d.humidity !== '—' ? `<div class="ww-row"><span class="ww-row-label">💧 ${_wwt('humidity')}</span><span class="ww-row-val">${d.humidity}</span></div>` : ''}
      </div>
      <div class="ww-footer">${provider}</div>
    </div>`;
}

function _renderL(container, data, cityLabel, provider) {
  const { current: d, hourly, daily } = data;

  const hourlyHtml = hourly.length ? `
    <div class="ww-section-title">${_wwt('hourly')}</div>
    <div class="ww-hourly">
      ${hourly.map(h => `
        <div class="ww-hour">
          <div class="ww-hour-time">${h.time}</div>
          <div class="ww-hour-icon">${h.icon}</div>
          <div class="ww-hour-temp">${h.temp}</div>
          <div class="ww-hour-rain">💧${h.rain}</div>
          <div class="ww-hour-wind">💨${h.wind}</div>
        </div>`).join('')}
    </div>` : '';

  const dailyHtml = daily.length ? `
    <div class="ww-section-title">${_wwt('forecast')}</div>
    <div class="ww-daily">
      ${daily.map(d => `
        <div class="ww-day">
          <div class="ww-day-name">${d.day}</div>
          <div class="ww-day-icon">${d.icon}</div>
          <div class="ww-day-temps"><span class="ww-day-max">${d.max}</span><span class="ww-day-min">${d.min}</span></div>
          <div class="ww-day-rain">💧${d.rain}</div>
          <div class="ww-day-wind">💨${d.wind}</div>
        </div>`).join('')}
    </div>` : '';

  container.innerHTML = `
    <div class="ww-wrap ww-l">
      <div class="ww-header">
        <div class="ww-city">${cityLabel}</div>
        <div class="ww-main">
          <div class="ww-icon">${d.icon}</div>
          <div class="ww-temp-block">
            <div class="ww-temp">${d.temp}</div>
            <div class="ww-desc">${d.desc}</div>
          </div>
        </div>
      </div>
      <div class="ww-body">
        <div class="ww-row"><span class="ww-row-label">🌡️ ${_wwt('feels')}</span><span class="ww-row-val">${d.feels}</span></div>
        <div class="ww-row"><span class="ww-row-label">💨 ${_wwt('wind')}</span><span class="ww-row-val">${d.wind}</span></div>
        <div class="ww-row"><span class="ww-row-label">💨 ${_wwt('gust')}</span><span class="ww-row-val">${d.gust}</span></div>
        <div class="ww-row"><span class="ww-row-label">💧 ${_wwt('humidity')}</span><span class="ww-row-val">${d.humidity}</span></div>
        <div class="ww-row"><span class="ww-row-label">🌂 ${_wwt('rain')}</span><span class="ww-row-val">${d.rain}</span></div>
        <div class="ww-row"><span class="ww-row-label">☀️ ${_wwt('uv')}</span><span class="ww-row-val">${d.uv}</span></div>
      </div>
      ${hourlyHtml}
      ${dailyHtml}
      <div class="ww-footer">${provider}</div>
    </div>`;
}

// ── Main widget ───────────────────────────────────────────────────────────────
mvmOS.registerWidget({
  id: 'weather-widget',
  type: 'desktop',
  label: _wwt('label'),
  defaultX: 20,
  defaultY: 100,
  sizes: ['s', 'm', 'l'],
  defaultSize: 'm',
  useDb: true,
  settings: [
    { key: 'city',     label: 'City',     type: 'city',   default: '' },
    { key: 'provider', label: 'Provider', type: 'select',
      options: ['Open-Meteo', 'wttr.in'], default: 'Open-Meteo' },
    { key: 'units',    label: 'Units',    type: 'select',
      options: ['celsius', 'fahrenheit'], default: 'celsius' },
    { key: 'refresh',  label: 'Refresh (min)', type: 'number', default: 10, min: 1, max: 180 },
  ],

  init(container, size = 'm') {
    let _timer = null;
    const _db = mvmOS.widgetDb('weather-widget');

    async function _dbInit() {
      await _db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
    }
    async function _dbGet(key, def) {
      try {
        const rows = await _db.query('SELECT value FROM settings WHERE key=?', [key]);
        if (rows.length) return JSON.parse(rows[0].value);
      } catch(_) {}
      return def;
    }
    async function _dbSet(key, value) {
      await _db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', [key, JSON.stringify(value)]);
    }

    async function render() {
      const city     = await _dbGet('city', null);
      const country  = await _dbGet('country', null);
      const provider = await _dbGet('provider', 'Open-Meteo');
      const units    = await _dbGet('units', 'celsius');

      if (!city) {
        container.innerHTML = `<div class="ww-wrap"><div class="ww-error">${_wwt('no_city')}</div></div>`;
        return;
      }
      container.innerHTML = `<div class="ww-wrap"><div class="ww-loading">${_wwt('loading')}</div></div>`;

      try {
        let data;
        if (provider === 'wttr.in') {
          data = await _fetchWttr(city, country, units);
        } else {
          const geo = await _geocode(city, country);
          data = await _fetchOpenMeteo(geo.lat, geo.lon, units, size);
        }
        const cityLabel = country ? `${city}, ${country}` : city;
        if (size === 's')      _renderS(container, data, cityLabel);
        else if (size === 'l') _renderL(container, data, cityLabel, provider);
        else                   _renderM(container, data, cityLabel, provider);
      } catch (err) {
        container.innerHTML = `<div class="ww-wrap"><div class="ww-error">${_wwt('error')}<br><span style="font-size:.65rem">${err.message}</span></div></div>`;
      }
    }

    async function _startTimer() {
      clearInterval(_timer);
      const min = Math.max(1, parseInt(await _dbGet('refresh', 10)) || 10);
      _timer = setInterval(render, min * 60 * 1000);
    }

    _dbInit().then(() => { render(); _startTimer(); });

    window.addEventListener('widget-settings-changed', e => {
      if (e.detail?.id === 'weather-widget') { render(); _startTimer(); }
    });

    window.mvmOS?.onLangChange(() => render());
  },
});

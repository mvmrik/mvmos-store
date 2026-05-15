const _ww18n = {
  en: {
    label:    'Weather',
    loading:  'Loading…',
    error:    'Could not load weather',
    no_city:  'Set city in settings',
    wind:     'Wind',
    humidity: 'Humidity',
    feels:    'Feels like',
  },
  bg: {
    label:    'Времето',
    loading:  'Зарежда…',
    error:    'Неуспешно зареждане',
    no_city:  'Задайте град в настройките',
    wind:     'Вятър',
    humidity: 'Влажност',
    feels:    'Усеща се като',
  },
};
function _wwt(key) {
  const lang = window.mvmOS?.lang || 'en';
  return (_ww18n[lang] || _ww18n.en)[key] || key;
}

// ── WMO weather code → emoji + description ──────────────────────────────────
const WMO_CODES = {
  0:  ['☀️',  'Clear sky'],
  1:  ['🌤️', 'Mainly clear'],
  2:  ['⛅',  'Partly cloudy'],
  3:  ['☁️',  'Overcast'],
  45: ['🌫️', 'Foggy'],
  48: ['🌫️', 'Icy fog'],
  51: ['🌦️', 'Light drizzle'],
  53: ['🌦️', 'Drizzle'],
  55: ['🌧️', 'Heavy drizzle'],
  61: ['🌧️', 'Light rain'],
  63: ['🌧️', 'Rain'],
  65: ['🌧️', 'Heavy rain'],
  71: ['🌨️', 'Light snow'],
  73: ['🌨️', 'Snow'],
  75: ['❄️',  'Heavy snow'],
  77: ['🌨️', 'Snow grains'],
  80: ['🌦️', 'Light showers'],
  81: ['🌧️', 'Showers'],
  82: ['⛈️',  'Heavy showers'],
  85: ['🌨️', 'Snow showers'],
  86: ['❄️',  'Heavy snow showers'],
  95: ['⛈️',  'Thunderstorm'],
  96: ['⛈️',  'Thunderstorm + hail'],
  99: ['⛈️',  'Thunderstorm + heavy hail'],
};

function _wmoIcon(code) { return (WMO_CODES[code] || ['🌡️', ''])[0]; }
function _wmoDesc(code) { return (WMO_CODES[code] || ['', 'Unknown'])[1]; }

// ── Geocoding via Open-Meteo (free, no key) ──────────────────────────────────
async function _geocode(city, country) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=10&language=en&format=json`;
  const res = await fetch(url);
  const j = await res.json();
  if (!j.results?.length) throw new Error('City not found');
  // prefer result matching country code if provided
  const cc = (country || '').toUpperCase();
  const match = cc ? j.results.find(r => r.country_code === cc) : null;
  const r = match || j.results[0];
  return { lat: r.latitude, lon: r.longitude, name: r.name, country: r.country_code };
}

// ── Providers ────────────────────────────────────────────────────────────────
async function _fetchOpenMeteo(lat, lon, units) {
  const u = units === 'fahrenheit' ? 'fahrenheit' : 'celsius';
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&temperature_unit=${u}&wind_speed_unit=kmh&timezone=auto`;
  const res = await fetch(url);
  const j = await res.json();
  const c = j.current;
  const sym = units === 'fahrenheit' ? '°F' : '°C';
  return {
    icon:     _wmoIcon(c.weather_code),
    desc:     _wmoDesc(c.weather_code),
    temp:     Math.round(c.temperature_2m) + sym,
    feels:    Math.round(c.apparent_temperature) + sym,
    wind:     Math.round(c.wind_speed_10m) + ' km/h',
    humidity: c.relative_humidity_2m + '%',
  };
}

async function _fetchWttr(city, country, units) {
  const q = country ? `${city},${country}` : city;
  const url = `https://wttr.in/${encodeURIComponent(q)}?format=j1`;
  const res = await fetch(url);
  const j = await res.json();
  const c = j.current_condition[0];
  const isFahr = units === 'fahrenheit';
  const temp = isFahr ? c.temp_F + '°F' : c.temp_C + '°C';
  const feels = isFahr ? c.FeelsLikeF + '°F' : c.FeelsLikeC + '°C';
  const code = parseInt(c.weatherCode);
  return {
    icon:     _wmoIcon(code),
    desc:     c.weatherDesc?.[0]?.value || '',
    temp,
    feels,
    wind:     c.windspeedKmph + ' km/h',
    humidity: c.humidity + '%',
  };
}

async function _fetch7timer(lat, lon, units) {
  const url = `https://www.7timer.info/bin/api.pl?lon=${lon}&lat=${lat}&product=civillight&output=json`;
  const res = await fetch(url);
  const j = await res.json();
  const d = j.dataseries?.[0];
  if (!d) throw new Error('No data');
  const isFahr = units === 'fahrenheit';
  const toF = c => Math.round(c * 9 / 5 + 32);
  const maxC = d.temp2m?.max ?? '?';
  const minC = d.temp2m?.min ?? '?';
  const sym = isFahr ? '°F' : '°C';
  const max = isFahr ? toF(maxC) : maxC;
  const min = isFahr ? toF(minC) : minC;
  const WTYPE = {
    'clear': ['☀️', 'Clear'], 'pcloudy': ['⛅', 'Partly cloudy'],
    'mcloudy': ['🌥️', 'Mostly cloudy'], 'cloudy': ['☁️', 'Cloudy'],
    'humid': ['🌫️', 'Humid'], 'lightrain': ['🌦️', 'Light rain'],
    'oshower': ['🌦️', 'Occasional showers'], 'ishower': ['🌧️', 'Showers'],
    'lightsnow': ['🌨️', 'Light snow'], 'rain': ['🌧️', 'Rain'],
    'snow': ['❄️', 'Snow'], 'rainsnow': ['🌨️', 'Rain/snow'],
    'ts': ['⛈️', 'Thunderstorm'], 'tsrain': ['⛈️', 'Thunderstorm+rain'],
  };
  const [icon, desc] = WTYPE[d.weather] || ['🌡️', d.weather];
  return {
    icon,
    desc,
    temp:     `${max}${sym} / ${min}${sym}`,
    feels:    '—',
    wind:     d.wind10m_max ? `${d.wind10m_max * 3.6 | 0} km/h` : '—',
    humidity: '—',
  };
}

// ── Main widget ──────────────────────────────────────────────────────────────
mvmOS.registerWidget({
  id: 'weather-widget',
  type: 'desktop',
  label: _wwt('label'),
  defaultX: 20,
  defaultY: 100,
  useDb: true,
  settings: [
    { key: 'city',     label: 'City',     type: 'city',   default: '' },
    { key: 'provider', label: 'Provider', type: 'select',
      options: ['Open-Meteo', 'wttr.in'], default: 'Open-Meteo' },
    { key: 'units',    label: 'Units',    type: 'select',
      options: ['celsius', 'fahrenheit'], default: 'celsius' },
    { key: 'refresh',  label: 'Refresh (min)', type: 'number', default: 10, min: 1, max: 180 },
  ],

  init(container) {
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
        } else if (provider === '7timer') {
          const geo = await _geocode(city, country);
          data = await _fetch7timer(geo.lat, geo.lon, units);
        } else {
          const geo = await _geocode(city, country);
          data = await _fetchOpenMeteo(geo.lat, geo.lon, units);
        }

        const cityLabel = country ? `${city}, ${country}` : city;
        container.innerHTML = `
          <div class="ww-wrap">
            <div class="ww-header">
              <div class="ww-city">${cityLabel}</div>
              <div class="ww-main">
                <div class="ww-icon">${data.icon}</div>
                <div class="ww-temp-block">
                  <div class="ww-temp">${data.temp}</div>
                  <div class="ww-desc">${data.desc}</div>
                </div>
              </div>
            </div>
            <div class="ww-body">
              ${data.feels !== '—' ? `
              <div class="ww-row">
                <span class="ww-row-label">🌡️ ${_wwt('feels')}</span>
                <span class="ww-row-val">${data.feels}</span>
              </div>` : ''}
              <div class="ww-row">
                <span class="ww-row-label">💨 ${_wwt('wind')}</span>
                <span class="ww-row-val">${data.wind}</span>
              </div>
              ${data.humidity !== '—' ? `
              <div class="ww-row">
                <span class="ww-row-label">💧 ${_wwt('humidity')}</span>
                <span class="ww-row-val">${data.humidity}</span>
              </div>` : ''}
            </div>
            <div class="ww-footer">${provider}</div>
          </div>`;
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

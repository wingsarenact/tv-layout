(() => {
  const config = window.WINGS_TV_CONFIG || {};

  // Utilities
  const $ = (id) => document.getElementById(id);

  // Diagnostics removed (no-op)
  function logDiagnostics(_) {}

  // Decode common HTML entities present in some RSS titles
  const _htmlDecoder = document.createElement('textarea');
  function decodeHtmlEntities(text) {
    try {
      if (typeof text !== 'string' || !text) return text;
      _htmlDecoder.innerHTML = text;
      return _htmlDecoder.value;
    } catch (_) { return text; }
  }

  // Google Drive helpers
  function getDriveFolderId(idOrUrl) {
    if (!idOrUrl) return null;
    const value = String(idOrUrl);
    // Try URL parsing first
    try {
      const u = new URL(value);
      const parts = u.pathname.split('/');
      const idx = parts.indexOf('folders');
      if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
    } catch (_) {}
    // Fallback regex: /folders/{ID}
    const m = value.match(/\/folders\/([A-Za-z0-9_-]+)/);
    if (m && m[1]) return m[1];
    return value; // assume raw ID
  }

  async function listDriveFiles(folderIdOrUrl, mimeTypePrefix) {
    try {
      const apiKey = (config.googleDrive && config.googleDrive.apiKey) || '';
      const folderId = getDriveFolderId(folderIdOrUrl);
      if (!apiKey || !folderId) return [];
      const q = encodeURIComponent(`'${folderId}' in parents and trashed=false and mimeType contains '${mimeTypePrefix}'`);
      const fields = encodeURIComponent('files(id,name,mimeType)');
      const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&key=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Drive list failed');
      const data = await res.json();
      const files = data.files || [];
      return files.map(f => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        // Force export=download to avoid intermediate preview
        url: `https://drive.google.com/uc?id=${f.id}&export=download`
      }));
    } catch (e) {
      logDiagnostics('Drive listing failed');
      return [];
    }
  }

  // Dropbox helpers
  async function dropboxListFolder(pathLower) {
    const token = config.dropbox && config.dropbox.accessToken;
    if (!token) { logDiagnostics('Dropbox token missing'); return []; }
    if (!pathLower) return [];
    if (!pathLower.startsWith('/')) pathLower = `/${pathLower}`;
    let hasMore = true;
    let cursor = null;
    const entries = [];
    while (hasMore) {
      const url = cursor
        ? 'https://api.dropboxapi.com/2/files/list_folder/continue'
        : 'https://api.dropboxapi.com/2/files/list_folder';
      const body = cursor ? { cursor } : { path: pathLower, recursive: false, include_media_info: false, include_deleted: false };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) { let msg='Dropbox list failed'; try{const err=await res.json(); if(err&&err.error_summary) msg=`Dropbox list failed: ${err.error_summary}`;}catch{} logDiagnostics(msg); return []; }
      const data = await res.json();
      (data.entries || []).forEach(e => { if (e['.tag'] === 'file') entries.push(e); });
      hasMore = data.has_more;
      cursor = data.cursor;
    }
    return entries;
  }

  async function dropboxListFolderBySharedLink(sharedLinkUrl) {
    const token = config.dropbox && config.dropbox.accessToken;
    if (!token || !sharedLinkUrl) return [];
    const res = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_link_files', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: sharedLinkUrl, direct_only: false })
    });
    if (!res.ok) {
      let msg = 'Dropbox shared link list failed';
      try { const err = await res.json(); if (err && err.error_summary) msg = `Dropbox shared link list failed: ${err.error_summary}`; } catch {}
      logDiagnostics(msg);
      return [];
    }
    const data = await res.json();
    return (data && data.entries) ? data.entries.filter(e => e['.tag'] === 'file') : [];
  }

  async function dropboxDownloadToBlobUrl(pathLower) {
    const token = config.dropbox && config.dropbox.accessToken;
    if (!token || !pathLower) return null;
    const res = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({ path: pathLower })
      }
    });
    if (!res.ok) { return null; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    return url;
  }

  // Google Sheets CSV helpers
  async function fetchCsvLines(csvUrl) {
    if (!csvUrl) return [];
    const res = await fetch(csvUrl);
    if (!res.ok) return [];
    const text = await res.text();
    return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  }

  function parseUrlFromCsvLine(line) {
    if (line.startsWith('"')) {
      const end = line.indexOf('"', 1);
      if (end > 0) return line.slice(1, end);
    }
    return line.split(',')[0];
  }

  // Fixed-canvas autoscale (optional). Will scale 1920x1080 to window while preserving 16:9.
  function applyAutoScale() {
    const root = document.querySelector('.app');
    if (!root) return;
    if (config.autoScale === false) {
      root.style.transform = 'none';
      return;
    }
    const scaleX = window.innerWidth / 1920;
    const scaleY = window.innerHeight / 1080;
    const scale = Math.min(scaleX, scaleY);
    root.style.transform = `scale(${scale})`;
  }

  function formatDateToEST(date) {
    const options = {
      weekday: 'short', month: 'long', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
      timeZone: 'America/New_York'
    };
    // We need custom placement: Weekday Month Day, Year  Time AM/PM
    const dtf = new Intl.DateTimeFormat('en-US', options);
    const parts = dtf.formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    const weekday = parts.weekday;
    const month = parts.month;
    const day = parts.day;
    const year = parts.year;
    const hour = parts.hour;
    const minute = parts.minute;
    const dayPeriod = parts.dayPeriod;
    return `${weekday} ${month} ${day}, ${year}\t${hour}:${minute} ${dayPeriod}`;
  }

  function updateClock() {
    const date = new Date();
    const options = {
      weekday: 'short', month: 'long', day: 'numeric', year: 'numeric',
      timeZone: 'America/New_York'
    };
    const dateStr = new Intl.DateTimeFormat('en-US', options).format(date);
    const timeStr = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' }).format(date);
    const dateEl = $('date-text');
    const timeEl = $('time-text');
    if (dateEl) dateEl.textContent = dateStr;
    if (timeEl) timeEl.textContent = timeStr;
  }

  // Weather using Open-Meteo
  // Docs: https://open-meteo.com/en/docs
  const weatherIconMap = (code, isDay) => {
    const day = (name) => `assets/weather/${name}-day.svg`;
    const night = (name) => `assets/weather/${name}-night.svg`;
    const any = (name) => `assets/weather/${name}.svg`;

    switch (code) {
      case 0: // Clear sky
        return isDay ? any('clear-day') : any('clear-night');
      case 1: // Mainly clear
      case 2: // Partly cloudy
        return isDay ? any('partly-cloudy-day') : any('partly-cloudy-night');
      case 3: // Overcast
        return isDay ? any('overcast-day') : any('overcast-night');

      case 45: // Fog
      case 48:
        return isDay ? any('fog-day') : any('fog-night');

      case 51: // Drizzle
      case 53:
      case 55:
        return any('drizzle');

      case 56: // Freezing drizzle
      case 57:
        return any('sleet');

      case 61: // Rain
      case 63:
      case 65:
      case 80: // Rain showers
      case 81:
      case 82:
        return any('rain');

      case 66: // Freezing rain
      case 67:
        return any('sleet');

      case 71: // Snow
      case 73:
      case 75:
      case 77: // Snow grains
      case 85: // Snow showers
      case 86:
        return any('snow');

      case 95: // Thunderstorm
        return isDay ? any('thunderstorms-day') : any('thunderstorms-night');
      case 96: // Thunderstorm hail
      case 99:
        return any('thunderstorms');

      default:
        return any('cloudy');
    }
  };

  async function fetchWeather() {
    const { latitude, longitude, timezone } = config.location || {};
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', latitude);
    url.searchParams.set('longitude', longitude);
    url.searchParams.set('current_weather', 'true');
    url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,weathercode');
    url.searchParams.set('timezone', timezone || 'America/New_York');

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('Weather fetch failed');
    const data = await res.json();
    return data;
  }

  function renderWeather(data) {
    try {
      const current = data.current_weather;
      const daily = data.daily;
      const isDay = current.is_day === 1;
      const currentTempF = Math.round((current.temperature * 9) / 5 + 32);
      const minC = daily.temperature_2m_min[0];
      const maxC = daily.temperature_2m_max[0];
      const minF = Math.round((minC * 9) / 5 + 32);
      const maxF = Math.round((maxC * 9) / 5 + 32);

      const iconUrl = weatherIconMap(current.weathercode, isDay);
      renderWeatherIcon(iconUrl);
      $('weather-temp').textContent = `${currentTempF}°F`;
      $('weather-min').textContent = `${minF}°`; // 80% opacity via CSS
      $('weather-max').textContent = `${maxF}°`;

      // Position fill and current circle
      const range = maxF - minF;
      const pct = range > 0 ? ((currentTempF - minF) / range) * 100 : 0;
      $('weather-fill').style.width = `${Math.max(0, Math.min(100, pct))}%`;
      $('weather-current').style.left = `${Math.max(0, Math.min(100, pct))}%`;
    } catch (e) {
      console.error('Weather render error', e);
    }
  }

  async function renderWeatherIcon(iconUrl) {
    // Always use <object> so SMIL/CSS animations inside the SVG run
    renderWeatherIconViaObject(iconUrl);
  }

  function renderWeatherIconViaObject(iconUrl) {
    const container = $('weather-icon');
    if (!container) return;
    container.innerHTML = '';
    const obj = document.createElement('object');
    obj.type = 'image/svg+xml';
    obj.data = iconUrl;
    obj.width = 64;
    obj.height = 64;
    obj.style.width = '64px';
    obj.style.height = '64px';
    container.appendChild(obj);
    // Do not mutate internal SVG; animations rely on original structure
  }

  async function initWeather() {
    try {
      const data = await fetchWeather();
      renderWeather(data);
      // Refresh every 10 minutes
      setInterval(async () => {
        try {
          const d = await fetchWeather();
          renderWeather(d);
        } catch (e) { logDiagnostics('Weather refresh failed'); }
      }, 10 * 60 * 1000);
    } catch (e) {
      console.error('Weather init failed', e);
      logDiagnostics('Weather init failed');
    }
  }

  // Static Ads
  async function initStaticAds() {
    let list = [];
    const rotationMs = (config.staticAds && config.staticAds.rotationMs) || 10000;
    const img = $('static-image');
    const placeholder = $('static-placeholder');
    const playlistCsvUrl = config.staticAds && config.staticAds.playlistCsvUrl;
    const dropboxPath = config.staticAds && config.staticAds.dropboxFolderPath;
    const dropboxShared = config.staticAds && config.staticAds.dropboxSharedLinkUrl;
    const driveFolderUrl = null; // disable Drive when Dropbox is configured
    if (playlistCsvUrl) {
      const lines = await fetchCsvLines(playlistCsvUrl);
      const body = lines.slice(1);
      const urls = body.map(parseUrlFromCsvLine).filter(Boolean);
      if (urls.length) {
        list = urls;
        logDiagnostics(`Static images: ${urls.length}`);
      }
    } else if (dropboxShared) {
      const entries = await dropboxListFolderBySharedLink(dropboxShared);
      const imgs = entries.filter(e => /\.(png|jpe?g|gif|webp)$/i.test(e.name));
      const urls = [];
      for (const f of imgs) {
        const u = await dropboxDownloadToBlobUrl(f.path_lower || (f.path_display && f.path_display.toLowerCase()));
        if (u) urls.push(u);
      }
      if (urls.length) {
        list = urls;
        logDiagnostics(`Static images: ${urls.length}`);
      }
    } else if (dropboxPath) {
      const entries = await dropboxListFolder(dropboxPath);
      const imgs = entries.filter(e => /\.(png|jpe?g|gif|webp)$/i.test(e.name));
      const urls = [];
      for (const f of imgs) {
        const u = await dropboxDownloadToBlobUrl(f.path_lower);
        if (u) urls.push(u);
      }
      if (urls.length) {
        list = urls;
        logDiagnostics(`Static images: ${urls.length}`);
      }
    }
    if (!list.length) { if (placeholder) placeholder.classList.remove('hidden'); img.alt = ''; return; }
    if (placeholder) placeholder.classList.add('hidden');
    let idx = 0;
    const show = () => {
      const next = list[idx % list.length];
      img.onerror = () => { logDiagnostics('Static image load failed'); };
      img.onload = () => { logDiagnostics(''); };
      img.src = next;
      idx += 1;
    };
    show();
    setInterval(show, rotationMs);
  }

  // Video Ads
  async function initVideoAds() {
    let items = [];
    const videoA = $('video-player');
    const videoB = $('video-player-buffer');
    const placeholder = $('video-placeholder');
    const playlistCsvUrl = config.videoAds && config.videoAds.playlistCsvUrl;
    const dropboxPath = config.videoAds && config.videoAds.dropboxFolderPath;
    const dropboxShared = config.videoAds && config.videoAds.dropboxSharedLinkUrl;
    const driveFolderUrl = null; // disable Drive when Dropbox is configured
    if (playlistCsvUrl) {
      const lines = await fetchCsvLines(playlistCsvUrl);
      const body = lines.slice(1);
      const urls = body.map(parseUrlFromCsvLine).filter(Boolean);
      if (urls.length) {
        items = urls;
        logDiagnostics(`Videos: ${urls.length}`);
      }
    } else if (dropboxShared) {
      const entries = await dropboxListFolderBySharedLink(dropboxShared);
      const vids = entries.filter(e => /\.(mp4|webm|mov)$/i.test(e.name));
      const urls = [];
      for (const f of vids) {
        const u = await dropboxDownloadToBlobUrl(f.path_lower || (f.path_display && f.path_display.toLowerCase()));
        if (u) urls.push(u);
      }
      if (urls.length) {
        items = urls;
        logDiagnostics(`Videos: ${urls.length}`);
      }
    } else if (dropboxPath) {
      const entries = await dropboxListFolder(dropboxPath);
      const vids = entries.filter(e => /\.(mp4|webm|mov)$/i.test(e.name));
      const urls = [];
      for (const f of vids) {
        const u = await dropboxDownloadToBlobUrl(f.path_lower);
        if (u) urls.push(u);
      }
      if (urls.length) {
        items = urls;
        logDiagnostics(`Videos: ${urls.length}`);
      }
    }
    if (!items.length) { if (placeholder) placeholder.classList.remove('hidden'); logDiagnostics('No video ads'); return; }
    if (placeholder) placeholder.classList.add('hidden');

    let idx = 0;
    let showingA = true;

    const playOn = (el, src) => {
      el.src = src;
      el.currentTime = 0;
      el.play().catch(() => { logDiagnostics('Video play failed'); });
    };

    const crossfade = () => {
      if (showingA) {
        videoA.style.opacity = '1';
        videoB.style.opacity = '0';
      } else {
        videoA.style.opacity = '0';
        videoB.style.opacity = '1';
      }
    };

    const queueNext = () => {
      const nextSrc = items[idx % items.length];
      idx += 1;
      if (showingA) {
        videoB.oncanplay = () => {
          showingA = false;
          crossfade();
          videoA.pause();
        };
        playOn(videoB, nextSrc);
      } else {
        videoA.oncanplay = () => {
          showingA = true;
          crossfade();
          videoB.pause();
        };
        playOn(videoA, nextSrc);
      }
    };

    videoA.addEventListener('ended', queueNext);
    videoA.addEventListener('error', queueNext);
    videoB.addEventListener('ended', queueNext);
    videoB.addEventListener('error', queueNext);

    // Prime first and second
    playOn(videoA, items[idx % items.length]); idx += 1;
    playOn(videoB, items[idx % items.length]);
    videoB.addEventListener('canplay', () => { /* start with A visible, then hand off */ });
  }

  // News Ticker resilient RSS fetch with fallbacks
  async function fetchRssRss2Json(sourceUrl) {
    const url = new URL('https://api.rss2json.com/v1/api.json');
    url.searchParams.set('rss_url', sourceUrl);
    url.searchParams.set('count', '20');
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('rss2json failed');
    return res.json();
  }

  async function fetchRssFeed2Json(sourceUrl) {
    const url = new URL('https://feed2json.org/convert');
    url.searchParams.set('url', sourceUrl);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('feed2json failed');
    const data = await res.json();
    const items = (data.items || []).map(i => ({ title: i.title }));
    return { items };
  }

  async function fetchRssAllOriginsXml(sourceUrl) {
    // Try https and http mirrors via r.jina.ai
    const mirrors = [
      `https://r.jina.ai/https://${sourceUrl.replace(/^https?:\/\//, '')}`,
      `https://r.jina.ai/http://${sourceUrl.replace(/^https?:\/\//, '')}`
    ];
    let lastErr;
    for (const url of mirrors) {
      try {
        const res = await fetch(url);
        if (!res.ok) { lastErr = new Error('proxy failed'); continue; }
        const xml = await res.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, 'application/xml');
        const titleNodes = doc.querySelectorAll('item > title, entry > title');
        const titles = Array.from(titleNodes).map(n => n.textContent).filter(Boolean).slice(0, 20);
        if (titles.length) return { items: titles.map(t => ({ title: t })) };
        lastErr = new Error('no items');
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('proxy failed');
  }

  async function fetchRss(sourceUrl) {
    const timeoutMs = 6000;
    const withTimeout = (p) => Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))
    ]);
    // Try XML first via CORS-friendly mirror
    try { return await withTimeout(fetchRssAllOriginsXml(sourceUrl)); } catch (_) {}
    try { return await withTimeout(fetchRssRss2Json(sourceUrl)); } catch (_) {}
    try { return await withTimeout(fetchRssFeed2Json(sourceUrl)); } catch (e) {
      throw new Error('RSS fetch failed');
    }
  }

  async function fetchNewsJsonOrRss(name, rssUrl) {
    const base = (window.WINGS_TV_CONFIG && window.WINGS_TV_CONFIG.dataBaseUrl) || '';
    try {
      const url = base ? `${base}/data/news_${name}.json?t=${Date.now()}` : `data/news_${name}.json?t=${Date.now()}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const arr = await res.json();
        if (Array.isArray(arr) && arr.length) return arr.map(decodeHtmlEntities);
      }
    } catch {}
    // If external data host is configured, do not fall back to live RSS
    if (base) return [];
    const data = await fetchRss(rssUrl);
    return (data.items || [])
      .map(i => i.title)
      .filter(Boolean)
      .map(decodeHtmlEntities);
  }

  async function fetchScoresJson(league) {
    const base = (window.WINGS_TV_CONFIG && window.WINGS_TV_CONFIG.dataBaseUrl) || '';
    if (!base) return [];
    try {
      const url = `${base}/data/scores_${league}.json?t=${Date.now()}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const arr = await res.json();
        if (Array.isArray(arr) && arr.length) return arr;
      }
    } catch {}
    return [];
  }

  function animateTickerSourceLabel(nextLabel) {
    const source = $('ticker-source');
    if (!source) return;
    source.classList.remove('animate-in');
    source.classList.add('animate-out');
    setTimeout(() => {
      source.textContent = String(nextLabel || '').toUpperCase();
      source.classList.remove('animate-out');
      source.classList.add('animate-in');
    }, 150);
  }

  function scrollTicker(text, sourceName) {
    const track = document.querySelector('.ticker-track');
    const content = $('ticker-content');
    animateTickerSourceLabel(sourceName);
    content.innerHTML = text;
    // Reset animation by forcing reflow and then transition
    const width = content.getBoundingClientRect().width;
    content.style.transform = `translateX(${track.clientWidth}px)`;
    content.style.transition = 'none';
    // Reflow
    void content.offsetWidth;
    const speed = config.ticker && config.ticker.scrollSpeedPxPerSec || 160;
    const distance = width + track.clientWidth;
    const duration = distance / speed; // seconds
    content.style.transition = `transform ${duration}s linear`;
    content.style.transform = `translateX(-${width}px)`;
    // Return duration in ms so caller can rotate at the right time
    return Math.max(1000, Math.round(duration * 1000));
  }

  function buildWeatherTickerText(latestWeatherData) {
    try {
      if (!latestWeatherData || !latestWeatherData.current_weather || !latestWeatherData.daily) return '';
      const current = latestWeatherData.current_weather;
      const daily = latestWeatherData.daily;
      const currentTempF = Math.round((current.temperature * 9) / 5 + 32);

      const days = daily.time || [];
      const loc = config.locationName || '';
      const condition = (() => {
        const icon = weatherIconMap(current.weathercode, true);
        return icon.split('/').pop().replace('.svg','').replace(/[-_]/g,' ').replace('day','').replace('night','').trim();
      })();
      const parts = [
        loc ? `${loc}` : '',
        `Now ${currentTempF}°F${condition ? ' ' + condition : ''}`
      ].filter(Boolean);
      // Start from tomorrow to show the next 5 days; format in the configured timezone
      const tz = (config.location && config.location.timezone) || 'America/New_York';
      for (let i = 1; i <= Math.min(5, days.length - 1); i++) { // next 5
        const wk = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(new Date(days[i] + 'T12:00:00'));
        const minF = Math.round((daily.temperature_2m_min[i] * 9) / 5 + 32);
        const maxF = Math.round((daily.temperature_2m_max[i] * 9) / 5 + 32);
        const dayCond = (() => {
          const icon = weatherIconMap(daily.weathercode[i], true);
          return icon.split('/').pop().replace('.svg','').replace(/[-_]/g,' ').replace('day','').replace('night','').trim();
        })();
        parts.push(`${wk} ${minF}-${maxF}°F${dayCond ? ' ' + dayCond : ''}`);
      }
      return parts.join('<span class="bullet">   •   </span>');
    } catch (e) {
      return '';
    }
  }

  async function initTicker() {
    const tcfg = config.ticker || {};
    const sources = tcfg.sources || [];
    if (!sources.length) return;

    let sourceIndex = 0;
    let lastWasWeather = false;
    let nonWeatherShownSinceWeather = true;
    let latestWeatherData = null;

    const refreshWeatherForTicker = async () => {
      try {
        latestWeatherData = await fetchWeather();
      } catch (e) {}
    };
    refreshWeatherForTicker();
    setInterval(refreshWeatherForTicker, 10 * 60 * 1000);
    async function cycle() {
      const src = sources[sourceIndex % sources.length];
      // Avoid back-to-back weather repeats even when other sources fail
      if (src.type === 'weather' && lastWasWeather) {
        sourceIndex += 1;
      }
      const chosen = sources[sourceIndex % sources.length];
      sourceIndex += 1;
      let nextDelayMs = tcfg.perSourceMs || 30000;
      try {
        if (chosen.type === 'weather') {
          if (!nonWeatherShownSinceWeather) {
            // Skip weather until at least one non-weather has been shown
            return 200; // very quick hop to next
          }
          if (!latestWeatherData) {
            try { latestWeatherData = await fetchWeather(); } catch (e) {}
          }
          const text = buildWeatherTickerText(latestWeatherData);
          if (text && text.trim()) {
            nextDelayMs = scrollTicker(text, chosen.name || 'Weather');
            lastWasWeather = true;
            nonWeatherShownSinceWeather = false;
          } else {
            nextDelayMs = 1500;
            lastWasWeather = true;
          }
        } else if (chosen.type === 'scores') {
          const items = await fetchScoresJson(chosen.league);
          const text = items.join('<span class="bullet">   •   </span>');
          if (text && text.trim()) {
            nextDelayMs = scrollTicker(text, chosen.name);
            lastWasWeather = false;
            nonWeatherShownSinceWeather = true;
          } else {
            nextDelayMs = 1500;
            lastWasWeather = false;
          }
        } else {
          const nameKey = (chosen.name || '').toLowerCase().includes('espn') ? 'espn'
            : (chosen.name || '').toLowerCase().includes('nhl') ? 'nhl'
            : (chosen.name || '').toLowerCase().includes('fox') ? 'fox'
            : (chosen.name || '').toLowerCase().includes('cbs') ? 'cbs'
            : 'misc';
          const items = await fetchNewsJsonOrRss(nameKey, chosen.url);
          const text = items.join('<span class="bullet">   •   </span>');
          if (text && text.trim()) {
            nextDelayMs = scrollTicker(text, chosen.name);
            lastWasWeather = false;
            nonWeatherShownSinceWeather = true;
          } else {
            nextDelayMs = 1500;
            lastWasWeather = false;
          }
        }
      } catch (e) {
        console.warn('Ticker source failed', chosen.name, e);
        nextDelayMs = 1500;
      }
      return nextDelayMs;
    }

    // Show immediate placeholder so footer is visibly active
    try {
      scrollTicker('Loading…', (sources[0] && sources[0].name) || 'Ticker');
    } catch (_) {}
    // Show immediate placeholder so footer is visibly active
    try {
      scrollTicker('Loading…', (sources[0] && sources[0].name) || 'Ticker');
    } catch (_) {}
    // Chain cycles so each source stays visible for its actual scroll duration
    // Deterministic source order without repeats; weather appears only once per full round
    const loop = async () => {
      const delay = await cycle();
      setTimeout(loop, delay + 300);
    };
    loop();
  }

  function initLogo() {
    const img = $('logo-img');
    if (config.logoSrc) img.src = config.logoSrc;
  }

  // Init all
  window.addEventListener('load', () => {
    applyAutoScale();
    window.addEventListener('resize', applyAutoScale);
    initLogo();
    updateClock();
    setInterval(updateClock, 1000);
    initWeather();
    (async () => { await initStaticAds(); await initVideoAds(); })();
    initTicker();
  });
})();



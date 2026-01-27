(() => {
  const config = window.WINGS_TV_CONFIG || {};

  // ========== PREVIEW MODES ==========
  // Set to true to preview holiday decorations regardless of date
  const PREVIEW_CHRISTMAS = false;
  const PREVIEW_NEW_YEARS = false;
  const PREVIEW_EASTER = false;
  const PREVIEW_VALENTINES = false;
  const PREVIEW_STPATRICKS = false;
  const PREVIEW_INDEPENDENCEDAY = false;
  const PREVIEW_HALLOWEEN = false;
  // ====================================

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
    // Update New Year's countdown if in range
    updateCountdown();
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

  // Temperature to color mapping (-20°F to 120°F)
  function getTemperatureColor(tempF) {
    // Clamp temperature to the range
    const clamped = Math.max(-20, Math.min(120, tempF));
    
    // Color stops every 10 degrees from -20 to 120
    // -20: Deep blue (very cold)
    // 0: Blue (freezing)
    // 20: Light blue/cyan (cold)
    // 40: Cyan/teal (cool)
    // 60: Green (mild)
    // 80: Yellow (warm)
    // 100: Orange (hot)
    // 120: Red (very hot)
    
    if (clamped <= -20) return '#1e3a8a'; // Deep blue
    if (clamped <= -10) return '#2563eb'; // Blue
    if (clamped <= 0) return '#3b82f6'; // Light blue
    if (clamped <= 10) return '#60a5fa'; // Lighter blue
    if (clamped <= 20) return '#7dd3fc'; // Cyan-blue
    if (clamped <= 30) return '#06b6d4'; // Cyan
    if (clamped <= 40) return '#14b8a6'; // Teal
    if (clamped <= 50) return '#10b981'; // Green-teal
    if (clamped <= 60) return '#22c55e'; // Green
    if (clamped <= 70) return '#84cc16'; // Yellow-green
    if (clamped <= 80) return '#eab308'; // Yellow
    if (clamped <= 90) return '#f59e0b'; // Orange-yellow
    if (clamped <= 100) return '#f97316'; // Orange
    if (clamped <= 110) return '#ef4444'; // Red-orange
    return '#dc2626'; // Red
  }

  function generateTemperatureGradient(minF, maxF) {
    // Generate color stops for the gradient based on the temperature range
    // Map the range to the full -20 to 120 scale
    const fullMin = -20;
    const fullMax = 120;
    const fullRange = fullMax - fullMin;
    
    // Calculate the position of min and max on the full scale (0-100%)
    const minPercent = ((minF - fullMin) / fullRange) * 100;
    const maxPercent = ((maxF - fullMin) / fullRange) * 100;
    
    // Generate color stops every 10 degrees within the visible range
    const stops = [];
    const startTemp = Math.floor(minF / 10) * 10; // Round down to nearest 10
    const endTemp = Math.ceil(maxF / 10) * 10; // Round up to nearest 10
    
    // Add start color
    const startColor = getTemperatureColor(minF);
    stops.push(`${startColor} 0%`);
    
    // Add intermediate stops every 10 degrees
    for (let temp = startTemp; temp <= endTemp; temp += 10) {
      if (temp > minF && temp < maxF) {
        const percent = ((temp - minF) / (maxF - minF)) * 100;
        const color = getTemperatureColor(temp);
        stops.push(`${color} ${percent}%`);
      }
    }
    
    // Add end color
    const endColor = getTemperatureColor(maxF);
    stops.push(`${endColor} 100%`);
    
    return `linear-gradient(90deg, ${stops.join(', ')})`;
  }

  async function fetchWeather() {
    const { latitude, longitude, timezone } = config.location || {};
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', latitude);
    url.searchParams.set('longitude', longitude);
    url.searchParams.set('current_weather', 'true');
    url.searchParams.set('hourly', 'apparent_temperature');
    url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,weathercode');
    url.searchParams.set('timezone', timezone || 'America/New_York');

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('Weather fetch failed');
    const data = await res.json();
    return data;
  }

  async function fetchWeatherAlerts() {
    const { latitude, longitude } = config.location || {};
    if (!latitude || !longitude) return null;
    
    try {
      // Step 1: Get grid point from coordinates
      const pointsUrl = `https://api.weather.gov/points/${latitude},${longitude}`;
      const userAgent = (config.location && config.location.nwsUserAgent) || 'Wings Arena TV (contact@example.com)';
      const pointsRes = await fetch(pointsUrl, {
        headers: { 'User-Agent': userAgent }
      });
      if (!pointsRes.ok) {
        console.warn('NWS points API failed:', pointsRes.status, pointsRes.statusText);
        return null;
      }
      const pointsData = await pointsRes.json();
      const forecastZoneUrl = pointsData.properties?.forecastZone;
      const countyZoneUrl = pointsData.properties?.county;
      
      // Step 2: Extract zone codes from URLs and fetch alerts
      // NWS API uses /alerts/active?zone=ZONECODE format
      const zoneCodes = [];
      
      // Extract zone code from forecast zone URL (e.g., "CTZ009" from full URL)
      if (forecastZoneUrl) {
        const match = forecastZoneUrl.match(/\/([A-Z]{2}[ZC]\d{3})$/);
        if (match) zoneCodes.push(match[1]);
      }
      
      // Extract zone code from county URL (e.g., "CTC001" from full URL)
      if (countyZoneUrl) {
        const match = countyZoneUrl.match(/\/([A-Z]{2}[ZC]\d{3})$/);
        if (match) zoneCodes.push(match[1]);
      }
      
      if (zoneCodes.length === 0) {
        console.warn('No forecast or county zone codes found');
        return null;
      }
      
      // Fetch alerts from all available zones using the correct endpoint
      const allAlerts = [];
      for (const zoneCode of zoneCodes) {
        try {
          const alertsUrl = `https://api.weather.gov/alerts/active?zone=${zoneCode}`;
          const alertsRes = await fetch(alertsUrl, {
            headers: { 'User-Agent': userAgent }
          });
          if (alertsRes.ok) {
            const alertsData = await alertsRes.json();
            if (alertsData.features && alertsData.features.length > 0) {
              allAlerts.push(...alertsData.features);
            }
          } else {
            console.warn('NWS alerts API failed for zone', zoneCode, alertsRes.status);
          }
        } catch (e) {
          console.warn('Failed to fetch alerts for zone', zoneCode, e);
        }
      }
      
      // Filter to active alerts only and remove duplicates
      const seenIds = new Set();
      const activeAlerts = allAlerts
        .filter(f => {
          const id = f.id || f.properties?.id;
          if (seenIds.has(id)) return false;
          seenIds.add(id);
          return f.properties?.status === 'Actual';
        })
        .map(f => ({
          event: f.properties.event,
          headline: f.properties.headline,
          description: f.properties.description,
          effective: f.properties.effective,
          expires: f.properties.expires,
          severity: f.properties.severity,
          urgency: f.properties.urgency
        }));
      
      return activeAlerts.length > 0 ? activeAlerts : null;
    } catch (e) {
      console.warn('Weather alerts fetch failed', e);
      return null;
    }
  }

  function renderWeather(data) {
    try {
      const current = data.current_weather;
      const daily = data.daily;
      const hourly = data.hourly;
      const isDay = current.is_day === 1;
      const currentTempF = Math.round((current.temperature * 9) / 5 + 32);
      const minC = daily.temperature_2m_min[0];
      const maxC = daily.temperature_2m_max[0];
      const minF = Math.round((minC * 9) / 5 + 32);
      const maxF = Math.round((maxC * 9) / 5 + 32);

      // Get apparent temperature (feels like) from hourly data
      let feelsLikeF = null;
      if (hourly && hourly.apparent_temperature && hourly.time && hourly.apparent_temperature.length > 0) {
        // Open Meteo hourly data starts at midnight (00:00) of the current day
        // Calculate which hour index corresponds to the current time
        const currentTime = new Date(current.time);
        const currentHour = currentTime.getHours(); // 0-23
        
        // The hourly data index equals the hour of the day (0 = midnight, 14 = 2 PM, etc.)
        let timeIndex = currentHour;
        
        // Ensure we don't go out of bounds
        if (timeIndex >= hourly.time.length) {
          timeIndex = hourly.time.length - 1;
        }
        
        // If the data at this index is null, try the previous hour
        if ((hourly.apparent_temperature[timeIndex] === null || hourly.apparent_temperature[timeIndex] === undefined) && timeIndex > 0) {
          timeIndex = timeIndex - 1;
        }
        
        if (hourly.apparent_temperature[timeIndex] !== null && hourly.apparent_temperature[timeIndex] !== undefined) {
          const feelsLikeC = hourly.apparent_temperature[timeIndex];
          feelsLikeF = Math.round((feelsLikeC * 9) / 5 + 32);
        }
      }

      const iconUrl = weatherIconMap(current.weathercode, isDay);
      renderWeatherIcon(iconUrl);
      $('weather-temp').textContent = `${currentTempF}°F`;
      $('weather-min').textContent = `${minF}°`; // 80% opacity via CSS
      $('weather-max').textContent = `${maxF}°`;

      // Display feels like temperature if available
      const feelsLikeEl = $('weather-feels-like');
      if (feelsLikeEl) {
        if (feelsLikeF !== null) {
          feelsLikeEl.textContent = `Feels Like: ${feelsLikeF}°F`;
          feelsLikeEl.style.display = 'block';
        } else {
          feelsLikeEl.style.display = 'none';
        }
      }

      // Generate and apply temperature-based gradient
      const gradient = generateTemperatureGradient(minF, maxF);
      $('weather-fill').style.background = gradient;
      
      // Position fill and current circle
      const range = maxF - minF;
      const pct = range > 0 ? ((currentTempF - minF) / range) * 100 : 0;
      $('weather-fill').style.width = `${Math.max(0, Math.min(100, pct))}%`;
      $('weather-current').style.left = `${Math.max(0, Math.min(100, pct))}%`;
    } catch (e) {
      console.error('Weather render error', e);
    }
  }

  function renderWeatherAlert(alerts) {
    const alertEl = $('weather-alert');
    if (!alertEl) return;
    
    if (!alerts || alerts.length === 0) {
      alertEl.classList.add('hidden');
      return;
    }
    
    // Get the most urgent alert (prioritize warnings over advisories)
    const sortedAlerts = alerts.sort((a, b) => {
      const severityOrder = { 'Extreme': 0, 'Severe': 1, 'Moderate': 2, 'Minor': 3, 'Unknown': 4 };
      return (severityOrder[a.severity] || 4) - (severityOrder[b.severity] || 4);
    });
    const alert = sortedAlerts[0];
    
    // Format expiration time
    let expiresText = '';
    if (alert.expires) {
      // NWS API returns times in ISO 8601 format, typically UTC
      // Ensure we parse it correctly - if no timezone specified, treat as UTC
      let expiresDateStr = alert.expires;
      // If the string doesn't end with Z or have timezone offset, assume UTC
      if (!expiresDateStr.endsWith('Z') && !expiresDateStr.match(/[+-]\d{2}:\d{2}$/)) {
        expiresDateStr = expiresDateStr + 'Z';
      }
      const expiresDate = new Date(expiresDateStr);
      const timezone = (config.location && config.location.timezone) || 'America/New_York';
      const timeStr = expiresDate.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true,
        timeZone: timezone
      });
      expiresText = ` until ${timeStr}`;
    }
    
    alertEl.textContent = `${alert.event}${expiresText}`;
    alertEl.classList.remove('hidden');
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
      
      // Fetch and display alerts
      const alerts = await fetchWeatherAlerts();
      renderWeatherAlert(alerts);
      
      // Refresh every 10 minutes
      setInterval(async () => {
        try {
          const d = await fetchWeather();
          renderWeather(d);
          const a = await fetchWeatherAlerts();
          renderWeatherAlert(a);
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
    let firstShownAt = null; // timestamp when the first static image became visible
    const rotationMs = (config.staticAds && config.staticAds.rotationMs) || 15000;
    const img = $('static-image');
    const imgBuffer = $('static-image-buffer');
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
    } else {
      // Auto-detect local static images, but show the first image immediately
      const firstImagePath = 'assets/static/ad01.png';

      // Optimistically hide placeholder and show first image right away.
      // The <img> tag in index.html already points at this path, so this
      // just ensures the placeholder disappears immediately at runtime.
      if (placeholder) placeholder.classList.add('hidden');
      img.src = firstImagePath;
      firstShownAt = Date.now();

      const firstImgTest = new Image();
      let firstImageStarted = true;
      firstImgTest.onerror = () => {
        // If the file is actually missing, allow detection logic to fall back
        firstImageStarted = false;
      };
      firstImgTest.src = firstImagePath;

      // Continue with full detection in the background
      const localImages = await detectLocalStaticImages();
      if (localImages.length) {
        list = localImages;
        logDiagnostics(`Static images: ${list.length}`);
        
        // If first image wasn't already loading, start it now
        if (!firstImageStarted && list[0]) {
          if (placeholder) placeholder.classList.add('hidden');
          img.src = list[0];
        }
      } else if (!firstImageStarted) {
        // No images found and first didn't load
        if (placeholder) placeholder.classList.remove('hidden'); 
        img.alt = ''; 
        if (imgBuffer) imgBuffer.alt = '';
        return;
      }
    }
    
    if (!list.length) { 
      // Only show placeholder if no images were detected and none loaded
      if (placeholder && !img.src.includes('ad')) {
        placeholder.classList.remove('hidden'); 
        img.alt = ''; 
        if (imgBuffer) imgBuffer.alt = '';
      }
      return; 
    }
    
    if (placeholder) placeholder.classList.add('hidden');
    
    // Determine starting index - if first image already loaded, start at index 1
    let idx = 0;
    if (list.length > 0 && (img.src === list[0] || img.src.includes('ad01'))) {
      idx = 1;
    }
    
    let isTransitioning = false;
    let currentImg = img; // Track which image is currently visible
    let bufferImg = imgBuffer;
    const preloadedImages = new Map(); // Cache for preloaded images
    
    // Preload next few images for faster transitions
    const preloadNextImages = () => {
      for (let i = 1; i <= 3; i++) { // Preload next 3 images
        const nextIdx = (idx + i) % list.length;
        const nextSrc = list[nextIdx];
        if (nextSrc && !preloadedImages.has(nextSrc)) {
          const preloadImg = new Image();
          preloadImg.src = nextSrc;
          preloadedImages.set(nextSrc, preloadImg);
        }
      }
    };
    
    const show = () => {
      if (isTransitioning || !list.length) return;
      const next = list[idx % list.length];
      
      // Check if image is already preloaded
      const preloadedImg = preloadedImages.get(next);
      
      if (preloadedImg && preloadedImg.complete) {
        // Image is already loaded, start transition immediately
        bufferImg.src = next;
        isTransitioning = true;
        bufferImg.style.opacity = '1';
        currentImg.style.opacity = '0';
        
        setTimeout(() => {
          const temp = currentImg;
          currentImg = bufferImg;
          bufferImg = temp;
          isTransitioning = false;
          preloadNextImages(); // Preload next batch
        }, 1000);
      } else {
        // Load next image in buffer
        bufferImg.onload = () => {
          // Start fade transition
          isTransitioning = true;
          bufferImg.style.opacity = '1';
          currentImg.style.opacity = '0';
          
          // After transition completes, swap which image is current/buffer
          setTimeout(() => {
            // Swap the roles
            const temp = currentImg;
            currentImg = bufferImg;
            bufferImg = temp;
            isTransitioning = false;
            preloadNextImages(); // Preload next batch
          }, 1000); // Match CSS transition duration
        };
        
        bufferImg.onerror = () => { 
          logDiagnostics('Static image load failed'); 
          isTransitioning = false;
        };
        
        bufferImg.src = next;
      }
      
      idx += 1;
    };
    
    // Set up interval and start preloading
    img.onload = () => { 
      logDiagnostics(''); 
      if (list.length > 0) {
        preloadNextImages(); // Start preloading after first image loads
      }
    };
    
    // Set up interval for rotation
    if (list.length > 0) {
      // If we already showed the first image (local assets case), make sure
      // it stays on-screen for a full rotationMs before the first swap.
      if (firstShownAt) {
        const elapsed = Date.now() - firstShownAt;
        const initialDelay = Math.max(0, rotationMs - elapsed);
        setTimeout(() => {
          show();
          setInterval(show, rotationMs);
        }, initialDelay);
      } else {
        // For playlist/Dropbox cases, start rotation immediately as before.
        setInterval(show, rotationMs);
      }
    }
  }

  // Auto-detect local static images
  async function detectLocalStaticImages() {
    const images = [];
    const basePath = 'assets/static/';
    
    // Try to detect images by checking if they exist
    // We'll check for common naming patterns: ad01.png, ad02.png, etc. (up to ad50)
    for (let i = 1; i <= 50; i++) {
      const paddedNum = i.toString().padStart(2, '0');
      const imagePath = `${basePath}ad${paddedNum}.png`;
      
      try {
        const response = await fetch(imagePath, { method: 'HEAD' });
        if (response.ok) {
          images.push(imagePath);
        }
      } catch (e) {
        // Image doesn't exist, continue checking
      }
    }
    
    // Also check for other common formats
    const extensions = ['jpg', 'jpeg', 'gif', 'webp'];
    for (let i = 1; i <= 50; i++) {
      const paddedNum = i.toString().padStart(2, '0');
      for (const ext of extensions) {
        const imagePath = `${basePath}ad${paddedNum}.${ext}`;
        try {
          const response = await fetch(imagePath, { method: 'HEAD' });
          if (response.ok) {
            images.push(imagePath);
            break; // Found this number, move to next
          }
        } catch (e) {
          // Image doesn't exist, continue checking
        }
      }
    }
    
    return images.sort(); // Sort to ensure proper order
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
    if (!img) return;
    updateLogoForHoliday();
  }

  // Calculate Easter Sunday date for a given year (Computus algorithm)
  function getEasterDate(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }

  function updateLogoForHoliday() {
    const img = $('logo-img');
    if (!img) return;
    
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1-12
    const day = now.getDate();
    
    // Calculate Easter for current year
    const easterDate = getEasterDate(year);
    const easterWeekStart = new Date(easterDate);
    easterWeekStart.setDate(easterDate.getDate() - 7);
    
    // Check if any preview mode is active - if so, only use preview modes
    const hasPreviewMode = PREVIEW_NEW_YEARS || PREVIEW_EASTER || PREVIEW_VALENTINES || 
                          PREVIEW_STPATRICKS || PREVIEW_INDEPENDENCEDAY || PREVIEW_HALLOWEEN || PREVIEW_CHRISTMAS;
    
    // Holiday date checks (preview modes take priority if any are active)
    const isNewYears = hasPreviewMode ? PREVIEW_NEW_YEARS : (month === 12 && day >= 29) || (month === 1 && day <= 5);
    const isEaster = hasPreviewMode ? PREVIEW_EASTER : (now >= easterWeekStart && now < easterDate);
    const isValentines = hasPreviewMode ? PREVIEW_VALENTINES : (month === 2 && day >= 7 && day <= 14); // Week before Feb 14
    const isStPatricks = hasPreviewMode ? PREVIEW_STPATRICKS : (month === 3 && day >= 16 && day <= 18); // Day before/after March 17
    const isIndependenceDay = hasPreviewMode ? PREVIEW_INDEPENDENCEDAY : (month === 7 && day >= 1 && day <= 7); // July 1-7
    const isHalloween = hasPreviewMode ? PREVIEW_HALLOWEEN : (month === 10 && day >= 18 && day <= 31); // 2 weeks before Oct 31
    const isChristmas = hasPreviewMode ? PREVIEW_CHRISTMAS : (month === 12 && day >= 1 && day <= 28);
    
    // Apply holiday logo (priority order matters)
    if (isNewYears && config.logoNewYearsSrc) {
      img.src = config.logoNewYearsSrc;
      img.classList.add('holiday-logo');
    } else if (isEaster && config.logoEasterSrc) {
      img.src = config.logoEasterSrc;
      img.classList.add('holiday-logo');
    } else if (isValentines && config.logoValentinesSrc) {
      img.src = config.logoValentinesSrc;
      img.classList.add('holiday-logo');
    } else if (isStPatricks && config.logoStPatricksDaySrc) {
      img.src = config.logoStPatricksDaySrc;
      img.classList.add('holiday-logo');
    } else if (isIndependenceDay && config.logoIndependenceDaySrc) {
      img.src = config.logoIndependenceDaySrc;
      img.classList.add('holiday-logo');
    } else if (isHalloween && config.logoHalloweenSrc) {
      img.src = config.logoHalloweenSrc;
      img.classList.add('holiday-logo');
    } else if (isChristmas && config.logoChristmasSrc) {
      img.src = config.logoChristmasSrc;
      img.classList.add('holiday-logo');
    } else {
      img.classList.remove('holiday-logo');
      if (config.logoSrc) {
        img.src = config.logoSrc;
      }
    }
  }

  // New Year's Countdown Functions
  function shouldShowCountdown() {
    if (PREVIEW_NEW_YEARS) return true;
    const now = new Date();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    // Show countdown Dec 29-31 only (before midnight Jan 1)
    return month === 12 && day >= 29;
  }

  function shouldShowHappyNewYear() {
    if (PREVIEW_NEW_YEARS) {
      // In preview mode, show "Happy New Year!" if we're past the new year
      const now = new Date();
      const target = getNewYearTimestamp();
      return target - now <= 0;
    }
    const now = new Date();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    // Show "Happy New Year!" on Jan 1-5
    return month === 1 && day >= 1 && day <= 5;
  }

  function getNewYearTimestamp() {
    const now = new Date();
    // Target: Jan 1 of next year at midnight in local time
    return new Date(now.getFullYear() + 1, 0, 1, 0, 0, 0, 0);
  }

  function updateCountdown() {
    const el = $('countdown-text');
    if (!el) return;
    
    // Check if we should show "Happy New Year!" message (Jan 1-5)
    if (shouldShowHappyNewYear()) {
      el.textContent = 'Happy New Year!';
      el.classList.remove('hidden');
      return;
    }
    
    // Check if we should show countdown (Dec 29-31)
    if (!shouldShowCountdown()) {
      el.classList.add('hidden');
      return;
    }
    
    const now = new Date();
    const target = getNewYearTimestamp();
    const diff = target - now;
    
    if (diff <= 0) {
      // Past midnight, show "Happy New Year!" instead
      el.textContent = 'Happy New Year!';
      el.classList.remove('hidden');
      return;
    }
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((diff % (1000 * 60)) / 1000);
    
    const pad = (n) => n.toString().padStart(2, '0');
    const nextYear = now.getFullYear() + 1;
    el.textContent = `${pad(days)}:${pad(hours)}:${pad(mins)}:${pad(secs)} Until ${nextYear}`;
    el.classList.remove('hidden');
  }

  function initFestiveDecorations() {
    const overlayTop = $('festive-overlay');
    const overlayBottom = $('festive-overlay-bottom');
    const santaHat = $('santa-hat-overlay');
    if (!overlayTop || !overlayBottom) return;
    
    const now = new Date();
    const month = now.getMonth() + 1; // 1-12 (January = 1, December = 12)
    const day = now.getDate();
    
    // Remove all festive classes first
    overlayTop.classList.remove('christmas');
    overlayBottom.classList.remove('christmas');
    if (santaHat) santaHat.classList.remove('christmas');
    
    // Check for New Years preview or actual date range (Dec 29 - Jan 5)
    const isNewYears = PREVIEW_NEW_YEARS || (month === 12 && day >= 29) || (month === 1 && day <= 5);
    // Check for Christmas preview or actual date range (Dec 1 - Dec 28)
    const isChristmas = PREVIEW_CHRISTMAS || (month === 12 && day >= 1 && day <= 28);
    
    // New Years doesn't have overlay decorations (just logo + countdown)
    // Christmas has overlay decorations
    if (isNewYears) {
      // New Years: no overlay decorations, just logo swap (handled by updateLogoForHoliday)
      updateLogoForHoliday();
    } else if (isChristmas) {
      // Christmas: show overlay decorations
      overlayTop.classList.add('christmas');
      overlayBottom.classList.add('christmas');
      if (santaHat) santaHat.classList.add('christmas');
      updateLogoForHoliday();
    } else {
      // No holiday - use default logo
      updateLogoForHoliday();
    }
  }

  // Init all
  window.addEventListener('load', () => {
    applyAutoScale();
    window.addEventListener('resize', applyAutoScale);
    initLogo();
    updateClock();
    setInterval(updateClock, 1000);
    initWeather();
    initFestiveDecorations();
    (async () => { await initStaticAds(); await initVideoAds(); })();
    initTicker();
  });
})();



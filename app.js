(() => {
  const config = window.WINGS_TV_CONFIG || {};

  // Utilities
  const $ = (id) => document.getElementById(id);

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
    url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min');
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
        } catch (e) {}
      }, 10 * 60 * 1000);
    } catch (e) {
      console.error('Weather init failed', e);
    }
  }

  // Static Ads
  function initStaticAds() {
    const list = (config.staticAds && config.staticAds.items) || [];
    const rotationMs = (config.staticAds && config.staticAds.rotationMs) || 10000;
    const img = $('static-image');
    if (!list.length) {
      img.alt = 'No static ads configured';
      return;
    }
    let idx = 0;
    const show = () => {
      img.src = list[idx % list.length];
      idx += 1;
    };
    show();
    setInterval(show, rotationMs);
  }

  // Video Ads
  function initVideoAds() {
    const items = (config.videoAds && config.videoAds.items) || [];
    const video = $('video-player');
    if (!items.length) return;
    let idx = 0;
    const playNext = () => {
      const src = items[idx % items.length];
      idx += 1;
      video.src = src;
      video.currentTime = 0;
      video.play().catch(() => {});
    };
    video.addEventListener('ended', playNext);
    video.addEventListener('error', playNext);
    playNext();
  }

  // News Ticker via RSS to JSON proxy
  // We'll use a simple public proxy (rss2json). For production, consider a server-side proxy.
  async function fetchRss(sourceUrl) {
    const url = new URL('https://api.rss2json.com/v1/api.json');
    url.searchParams.set('rss_url', sourceUrl);
    url.searchParams.set('count', '20');
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('RSS fetch failed');
    return res.json();
  }

  function scrollTicker(text, sourceName) {
    const track = document.querySelector('.ticker-track');
    const content = $('ticker-content');
    const source = $('ticker-source');
    source.textContent = sourceName.toUpperCase();
    content.textContent = text;
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
  }

  async function initTicker() {
    const tcfg = config.ticker || {};
    const sources = tcfg.sources || [];
    if (!sources.length) return;

    let sourceIndex = 0;
    async function cycle() {
      const src = sources[sourceIndex % sources.length];
      sourceIndex += 1;
      try {
        const data = await fetchRss(src.url);
        const items = (data.items || []).map(i => i.title).filter(Boolean);
        const text = items.join('   •   ');
        if (text) scrollTicker(text, src.name);
      } catch (e) {
        console.warn('Ticker source failed', src.name, e);
      }
    }

    await cycle();
    setInterval(cycle, tcfg.refreshMs || 300000);
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
    initStaticAds();
    initVideoAds();
    initTicker();
  });
})();



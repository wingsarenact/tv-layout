# Wings Arena TV Layout

A 1920x1080 web page for Mvix digital signage.

Zones:
- Top (1920x180): Date/Time (EST), centered logo, weather with min/current/max bar
- Middle (1920x720): Left static image rotator (640x720), right video playlist (1280x720)
- Bottom (1920x180): Multi-source news ticker with source label

## Usage
Open `index.html` in a modern Chromium-based browser (kiosk mode recommended). No keyboard/mouse interaction required.

## Configuration (`config.js`)
- `location` (lat/lon/timezone) for weather
- `logoSrc` path to logo image
- `staticAds.items` (image URLs), `rotationMs` slide duration
- `videoAds.items` (video URLs)
- `ticker.sources` RSS feed URLs, `refreshMs`, `scrollSpeedPxPerSec`

## Assets
Place assets under `assets/`:
- `assets/logo.png`
- `assets/static/*.jpg|png`
- `assets/video/*.mp4` (H.264 recommended)
- `assets/weather/*.png` (icons referenced in `app.js`)

## Notes
- Weather via Open-Meteo.
- RSS via rss2json public API; for production, consider a simple server-side proxy to avoid rate limits.
- Designed for 1920x1080 (16:9) and passive display.

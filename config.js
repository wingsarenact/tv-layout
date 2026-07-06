window.WINGS_TV_CONFIG = {
  // Optional external data host (GitHub Pages data repo)
  dataBaseUrl: 'https://wingsarenact.github.io/tv-data',

  // Autoscale the 1920x1080 canvas to the player window. Set to false for exact 1:1.
  autoScale: true,

  // Location for weather (Stamford, CT - zip 06902)
  location: {
    latitude: 41.05949,
    longitude: -73.54751,
    timezone: 'America/New_York',
    // Optional: Custom User-Agent for NWS API (required by NWS, defaults to 'Wings Arena TV (contact@example.com)')
    // nwsUserAgent: 'Wings Arena TV (your-email@example.com)'
  },

  locationName: 'Stamford, CT',

  // Logo asset paths
  logoSrc: 'assets/logo.png',
  logoChristmasSrc: 'assets/festive/logo_christmas.gif',
  logoNewYearsSrc: 'assets/festive/logo_newyears.gif',
  logoEasterSrc: 'assets/festive/logo_easter.gif',
  logoValentinesSrc: 'assets/festive/logo_valentines.gif',
  logoHalloweenSrc: 'assets/festive/logo_halloween.gif',
  logoStPatricksDaySrc: 'assets/festive/logo_stpatricksday.gif',
  logoIndependenceDaySrc: 'assets/festive/logo_independenceday.gif',

  // Static images playlist (can be absolute URLs). Drive disabled when Dropbox is configured.
  staticAds: {
    rotationMs: 8000,
    // Local static ads playlist; all ads are stored in assets/static/
    // Configure the exact list you want to rotate through, in order.
    items: [
      'assets/static/ad01.png',
      'assets/static/ad02.png',
      'assets/static/ad03.png',
      'assets/static/ad04.png',
      'assets/static/ad06.png',
      'assets/static/ad07.png'
    ]
  },

  // Video playlist (MP4/H.264 recommended). Drive disabled when Dropbox is configured.
  videoAds: {
    playlistCsvUrl: '',
    driveFolderUrl: '',
    items: [
      'assets/video/sample1.mp4',
      'assets/video/sample2.mp4'
    ]
  },

  // RSS sources for ticker
  ticker: {
    refreshMs: 5 * 60 * 1000,
    scrollSpeedPxPerSec: 160,
    perSourceMs: 30000,
    sources: [
      { name: 'ESPN', url: 'https://www.espn.com/espn/rss/news' },
      { name: 'Weather', type: 'weather' }, // Weather appears early in rotation
      { name: 'NHL News', url: 'https://thehockeywriters.com/feed/' },
      { name: 'FOX Sports', url: 'https://www.foxsports.com/feedout/syndicatedContent?categoryId=0' },
      { name: 'NHL Scores', type: 'scores', league: 'nhl' },
      { name: 'Weather', type: 'weather' }, // Weather appears again mid-rotation
      { name: 'NBA Scores', type: 'scores', league: 'nba' },
      { name: 'CBS Sports', url: 'https://www.cbssports.com/rss/headlines/' },
      { name: 'MLB Scores', type: 'scores', league: 'mlb' },
      { name: 'NFL Scores', type: 'scores', league: 'nfl' }
    ]
  }
};
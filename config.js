window.WINGS_TV_CONFIG = {
    // Optional external data host (GitHub Pages data repo)
    dataBaseUrl: 'https://wingsarenact.github.io/tv-data',
  // Autoscale the 1920x1080 canvas to the player window. Set to false for exact 1:1.
  autoScale: true,
  // Location for weather (Newark, DE as example - update as needed)
  location: {
    latitude: 39.6837,
    longitude: -75.7497,
    timezone: 'America/New_York'
  },
  locationName: 'Stamford, CT',

  // Logo asset path
  logoSrc: 'assets/logo.png',


  // Static images playlist (can be absolute URLs). Drive disabled when Dropbox is configured.
  staticAds: {
    rotationMs: 15000,
    // Placeholder-driven; external playlists handled by Mvix
    playlistCsvUrl: '',
    // Use this Drive folder to auto-list images (anyone-with-link must be viewer):
    driveFolderUrl: '',
    items: [
      'assets/static/ad01.png',
      'assets/static/ad02.png',
      'assets/static/ad03.png',
      'assets/static/ad04.png',
      'assets/static/ad05.png'
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
      { name: 'NHL News', url: 'https://thehockeywriters.com/feed/' },
      { name: 'FOX Sports', url: 'https://www.foxsports.com/feedout/syndicatedContent?categoryId=0' },
      { name: 'CBS Sports', url: 'https://www.cbssports.com/rss/headlines/' },
      { name: 'NHL Scores', type: 'scores', league: 'nhl' },
      { name: 'NBA Scores', type: 'scores', league: 'nba' },
      { name: 'MLB Scores', type: 'scores', league: 'mlb' },
      { name: 'NFL Scores', type: 'scores', league: 'nfl' },
      { name: 'Weather', type: 'weather' }
    ]
  }
};



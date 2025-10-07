window.WINGS_TV_CONFIG = {
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
    rotationMs: 10000,
    // Placeholder-driven; external playlists handled by Mvix
    playlistCsvUrl: '',
    // Use this Drive folder to auto-list images (anyone-with-link must be viewer):
    driveFolderUrl: '',
    items: [
      'assets/static/sample1.jpg',
      'assets/static/sample2.jpg',
      'assets/static/sample3.jpg'
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
      { name: 'FOX Sports', url: 'https://api.foxsports.com/v2/content/optimized-rss?partnerKey=MB0Wehpmuj2lUhuRhQaafhBjAJqaPU244mlTDK1i&aggregateId=7f83e8ca-6701-5ea0-96ee-072636b67336' },
      { name: 'NHL News', url: 'https://www.nhl.com/rss/news' },
      { name: 'Weather', type: 'weather' }
    ]
  }
};



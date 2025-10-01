window.WINGS_TV_CONFIG = {
  // Autoscale the 1920x1080 canvas to the player window. Set to false for exact 1:1.
  autoScale: true,
  // Location for weather (Newark, DE as example - update as needed)
  location: {
    latitude: 39.6837,
    longitude: -75.7497,
    timezone: 'America/New_York'
  },

  // Logo asset path
  logoSrc: 'assets/logo.png',

  // Static images playlist (can be absolute URLs). Change to Google Photos public links if needed.
  staticAds: {
    rotationMs: 10000,
    items: [
      'assets/static/sample1.jpg',
      'assets/static/sample2.jpg',
      'assets/static/sample3.jpg'
    ]
  },

  // Video playlist (MP4/H.264 recommended). Public URLs supported.
  videoAds: {
    items: [
      'assets/video/sample1.mp4',
      'assets/video/sample2.mp4'
    ]
  },

  // RSS sources for ticker
  ticker: {
    refreshMs: 5 * 60 * 1000,
    scrollSpeedPxPerSec: 160,
    sources: [
      { name: 'ESPN', url: 'https://www.espn.com/espn/rss/news' },
      { name: 'AP News', url: 'https://apnews.com/hub/ap-top-news?xml' }
    ]
  }
};



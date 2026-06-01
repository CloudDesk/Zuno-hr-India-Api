const { homedir } = require('os');
const { join } = require('path');

/**
 * Use Puppeteer's standard cache location unless the platform provides one.
 * This avoids partial browser installs being tied to dependency directories.
 * @type {import('puppeteer').Configuration}
 */
module.exports = {
  cacheDirectory: process.env.PUPPETEER_CACHE_DIR || join(homedir(), '.cache', 'puppeteer'),
  'chrome-headless-shell': {
    skipDownload: true,
  },
};

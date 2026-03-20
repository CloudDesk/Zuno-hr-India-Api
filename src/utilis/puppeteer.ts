import fs from 'fs';
import path from 'path';
import type { LaunchOptions } from 'puppeteer';

const DEFAULT_PUPPETEER_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--no-zygote'
];

const LOCAL_PUPPETEER_CACHE_DIR = path.join(process.cwd(), 'node_modules', '.puppeteer_cache');

const KNOWN_BROWSER_PATHS = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/snap/bin/chromium'
].filter((candidate): candidate is string => Boolean(candidate));

function resolveExecutablePath(): string | undefined {
    for (const candidate of KNOWN_BROWSER_PATHS) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return undefined;
}

export function getPuppeteerLaunchOptions(): LaunchOptions {
    process.env.PUPPETEER_CACHE_DIR = process.env.PUPPETEER_CACHE_DIR || LOCAL_PUPPETEER_CACHE_DIR;

    return {
        headless: true,
        executablePath: resolveExecutablePath(),
        args: DEFAULT_PUPPETEER_ARGS
    };
}

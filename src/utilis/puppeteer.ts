import fs from 'fs';
import os from 'os';
import path from 'path';
import type { LaunchOptions } from 'puppeteer';

const DEFAULT_PUPPETEER_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--no-zygote',
    '--disable-crashpad',
    '--disable-crash-reporter',
    '--disable-background-networking',
    '--disable-extensions',
    '--disable-sync',
    '--metrics-recording-only',
    '--mute-audio',
    '--hide-scrollbars',
    '--disable-software-rasterizer',
    '--disable-features=UseDBus'
];

const LOCAL_PUPPETEER_CACHE_DIR =
    process.env.PUPPETEER_CACHE_DIR || path.join(os.homedir(), '.cache', 'puppeteer');
const CHROMIUM_USER_DATA_DIR =
    process.env.PUPPETEER_USER_DATA_DIR || path.join('/tmp', 'puppeteer-user-data');

const KNOWN_BROWSER_PATHS = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/snap/bin/chromium'
].filter((candidate): candidate is string => Boolean(candidate));

export interface PuppeteerRuntimeConfig {
    launchOptions: LaunchOptions;
    executablePath?: string;
    browserReuse: boolean;
    defaultTimeoutMs: number;
    navigationTimeoutMs: number;
    pdfTimeoutMs: number;
    maxConcurrentPdfRenders: number;
    tempDir: string;
}

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

    const executablePath = resolveExecutablePath();

    return {
        headless: true,
        executablePath,
        args: DEFAULT_PUPPETEER_ARGS,
        userDataDir: CHROMIUM_USER_DATA_DIR
    };
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
    if (!value) return fallback;

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveTempDirectory(): string {
    const configuredDir = process.env.PAYSLIP_TEMP_DIR?.trim();
    if (configuredDir) {
        return configuredDir;
    }

    if (fs.existsSync('/tmp')) {
        return '/tmp';
    }

    return path.join(process.cwd(), 'uploads');
}

export function getPuppeteerRuntimeConfig(): PuppeteerRuntimeConfig {
    const launchOptions = getPuppeteerLaunchOptions();

    return {
        launchOptions,
        executablePath: launchOptions.executablePath,
        browserReuse: process.env.PUPPETEER_BROWSER_REUSE !== 'false',
        defaultTimeoutMs: parsePositiveInteger(process.env.PUPPETEER_DEFAULT_TIMEOUT_MS, 30000),
        navigationTimeoutMs: parsePositiveInteger(process.env.PUPPETEER_NAVIGATION_TIMEOUT_MS, 30000),
        pdfTimeoutMs: parsePositiveInteger(process.env.PUPPETEER_PDF_TIMEOUT_MS, 30000),
        maxConcurrentPdfRenders: parsePositiveInteger(process.env.PUPPETEER_MAX_CONCURRENT_RENDERS, 1),
        tempDir: resolveTempDirectory()
    };
}

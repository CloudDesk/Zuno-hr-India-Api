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
    '--disable-breakpad',
    '--disable-background-networking',
    '--disable-extensions',
    '--disable-sync',
    '--metrics-recording-only',
    '--mute-audio',
    '--hide-scrollbars',
    '--disable-software-rasterizer',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-dev-tools',
    '--no-default-browser-check',
    '--password-store=basic',
    '--use-mock-keychain',
    '--disable-features=UseDBus,Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints'
];

const LOCAL_PUPPETEER_CACHE_DIR =
    process.env.PUPPETEER_CACHE_DIR || path.join(os.homedir(), '.cache', 'puppeteer');

const SYSTEM_BROWSER_PATHS = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/snap/bin/chromium'
];

export interface PuppeteerRuntimeConfig {
    launchOptions: LaunchOptions;
    executablePath?: string;
    transport: 'pipe' | 'websocket';
    userDataDir: string;
    browserReuse: boolean;
    defaultTimeoutMs: number;
    navigationTimeoutMs: number;
    pdfTimeoutMs: number;
    maxConcurrentPdfRenders: number;
    tempDir: string;
}

function resolveExecutablePath(): string | undefined {
    const configuredPath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
    if (configuredPath) {
        return configuredPath;
    }

    if (process.env.PUPPETEER_USE_SYSTEM_CHROMIUM !== 'true') {
        return undefined;
    }

    for (const candidate of SYSTEM_BROWSER_PATHS) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return undefined;
}

export function getPuppeteerLaunchOptions(): LaunchOptions {
    process.env.PUPPETEER_CACHE_DIR = process.env.PUPPETEER_CACHE_DIR || LOCAL_PUPPETEER_CACHE_DIR;

    const executablePath = resolveExecutablePath();
    const userDataDir = process.env.PUPPETEER_USER_DATA_DIR || path.join(resolveTempDirectory(), 'chromium-user-data');

    return {
        headless: true,
        executablePath,
        userDataDir,
        timeout: 60000,
        args: DEFAULT_PUPPETEER_ARGS
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
        transport: launchOptions.pipe ? 'pipe' : 'websocket',
        userDataDir: launchOptions.userDataDir || '',
        browserReuse: process.env.PUPPETEER_BROWSER_REUSE !== 'false',
        defaultTimeoutMs: parsePositiveInteger(process.env.PUPPETEER_DEFAULT_TIMEOUT_MS, 30000),
        navigationTimeoutMs: parsePositiveInteger(process.env.PUPPETEER_NAVIGATION_TIMEOUT_MS, 30000),
        pdfTimeoutMs: parsePositiveInteger(process.env.PUPPETEER_PDF_TIMEOUT_MS, 30000),
        maxConcurrentPdfRenders: parsePositiveInteger(process.env.PUPPETEER_MAX_CONCURRENT_RENDERS, 1),
        tempDir: resolveTempDirectory()
    };
}

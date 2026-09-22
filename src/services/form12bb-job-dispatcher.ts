import axios from 'axios';
import { timingSafeEqual } from 'node:crypto';

export type Form12BBQueueMode = 'cloud-tasks' | 'inline';

// Temporary shared key used to authenticate Cloud Tasks worker callbacks.
// Keep the sender and receiver on the same value until IAM-based callback
// authentication is available.
const FORM12BB_WORKER_SECRET = '53e4ce17d1e77bf7cfa5fe29ee35a482dd3339a7b8c009ff1e6b11b84aef8ad8';

const getQueueMode = (): Form12BBQueueMode => {
    const configured = String(process.env.FORM12BB_QUEUE_MODE || '').trim().toLowerCase();
    if (configured === 'cloud-tasks' || configured === 'inline') return configured;
    return process.env.NODE_ENV === 'production' ? 'cloud-tasks' : 'inline';
};

export const isForm12BBCloudTasksMode = (): boolean => getQueueMode() === 'cloud-tasks';

const getDefaultWorkerUrl = (): string => {
    const apiUrl = String(process.env.API_URL || '').replace(/\/$/, '');
    return apiUrl ? `${apiUrl}/documents/form12bb/jobs/process` : '';
};

const getCloudTasksConfig = () => ({
    project: process.env.FORM12BB_TASKS_PROJECT || process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '',
    location: process.env.FORM12BB_TASKS_LOCATION || 'asia-south1',
    queue: process.env.FORM12BB_TASKS_QUEUE || 'form12bb-generation',
    workerUrl: process.env.FORM12BB_WORKER_URL || getDefaultWorkerUrl(),
    workerSecret: FORM12BB_WORKER_SECRET,
    serviceAccountEmail: process.env.FORM12BB_TASKS_SERVICE_ACCOUNT || '',
    audience: process.env.FORM12BB_WORKER_AUDIENCE || '',
});

export const assertForm12BBDispatcherConfigured = (): void => {
    if (!isForm12BBCloudTasksMode()) return;
    const config = getCloudTasksConfig();
    const missing = Object.entries({
        FORM12BB_TASKS_PROJECT: config.project,
        FORM12BB_WORKER_URL: config.workerUrl,
    }).filter(([, value]) => !value).map(([key]) => key);
    if (missing.length) {
        throw new Error(`Form 12BB bulk worker is not configured. Missing: ${missing.join(', ')}`);
    }
};

const getGoogleAccessToken = async (): Promise<string> => {
    const response = await axios.get(
        'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
        {
            headers: { 'Metadata-Flavor': 'Google' },
            timeout: 5000,
        },
    );
    const token = response.data?.access_token;
    if (!token) throw new Error('Google metadata server did not return an access token');
    return token;
};

export const enqueueForm12BBJob = async (jobId: string, delaySeconds = 0): Promise<void> => {
    assertForm12BBDispatcherConfigured();
    if (!isForm12BBCloudTasksMode()) return;

    const config = getCloudTasksConfig();
    const accessToken = await getGoogleAccessToken();
    const parent = `projects/${config.project}/locations/${config.location}/queues/${config.queue}`;
    const httpRequest: Record<string, any> = {
        httpMethod: 'POST',
        url: config.workerUrl,
        headers: {
            'Content-Type': 'application/json',
            'X-Form12BB-Worker-Secret': config.workerSecret,
        },
        body: Buffer.from(JSON.stringify({ jobId })).toString('base64'),
    };
    if (config.serviceAccountEmail) {
        httpRequest.oidcToken = {
            serviceAccountEmail: config.serviceAccountEmail,
            ...(config.audience ? { audience: config.audience } : {}),
        };
    }

    await axios.post(
        `https://cloudtasks.googleapis.com/v2/${parent}/tasks`,
        {
            task: {
                httpRequest,
                ...(delaySeconds > 0
                    ? { scheduleTime: new Date(Date.now() + delaySeconds * 1000).toISOString() }
                    : {}),
            },
        },
        {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 10000,
        },
    );
};

export const verifyForm12BBWorkerSecret = (received: unknown): boolean => {
    const expected = FORM12BB_WORKER_SECRET;
    const actual = typeof received === 'string' ? received : '';
    if (!expected || !actual) return false;
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(actual);
    return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
};

export const getForm12BBChunkSize = (): number => {
    const configured = Number(process.env.FORM12BB_JOB_CHUNK_SIZE || 3);
    return Number.isFinite(configured) ? Math.max(1, Math.min(10, Math.floor(configured))) : 3;
};

export const getForm12BBMaxAttempts = (): number => {
    const configured = Number(process.env.FORM12BB_JOB_MAX_ATTEMPTS || 3);
    return Number.isFinite(configured) ? Math.max(1, Math.min(10, Math.floor(configured))) : 3;
};

export const getForm12BBLeaseMilliseconds = (): number => {
    const configuredMinutes = Number(process.env.FORM12BB_JOB_LEASE_MINUTES || 20);
    const minutes = Number.isFinite(configuredMinutes) ? Math.max(5, Math.min(60, configuredMinutes)) : 20;
    return minutes * 60 * 1000;
};

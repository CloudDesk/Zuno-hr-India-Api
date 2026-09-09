declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: 'development' | 'production' | 'test';
      PORT: string;
      HOST: string;
      MONGODB_URI: string;
      JWT_SECRET: string;
      CORS_ORIGINS: string;
      GMAIL_SERVICE?: string;
      GMAIL_HOST?: string;
      GMAIL_PORT?: string;
      GMAIL_AUTH_USER?: string;
      GMAIL_AUTH_PASSWORD?: string;
      OUTLOOK_SERVICE?: string;
      OUTLOOK_HOST?: string;
      OUTLOOK_PORT?: string;
      OUTLOOK_AUTH_USER?: string;
      OUTLOOK_AUTH_PASSWORD?: string;
      OUTLOOK_FROM_EMAIL?: string;
      OUTLOOK_FROM_NAME?: string;
      PROJECT_ID: string;
      GCP_STORAGE_BUCKET: string;
      GCP_SERVICE_ACCOUNT_JSON?: string;
      GCP_CLIENT_EMAIL?: string;
      GCP_PRIVATE_KEY?: string;
      PUPPETEER_EXECUTABLE_PATH?: string;
      PUPPETEER_BROWSER_REUSE?: string;
      PUPPETEER_DEFAULT_TIMEOUT_MS?: string;
      PUPPETEER_NAVIGATION_TIMEOUT_MS?: string;
      PUPPETEER_PDF_TIMEOUT_MS?: string;
      PUPPETEER_MAX_CONCURRENT_RENDERS?: string;
      PAYSLIP_TEMP_DIR?: string;
    }
  }
}

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: 'development' | 'production' | 'test';
      PORT: string;
      HOST: string;
      MONGODB_URI: string;
      JWT_SECRET: string;
      CORS_ORIGINS: string;
      PROJECT_ID: string;
      GCP_STORAGE_BUCKET: string;
      GCP_SERVICE_ACCOUNT_JSON?: string;
      GCP_CLIENT_EMAIL?: string;
      GCP_PRIVATE_KEY?: string;
    }
  }
}

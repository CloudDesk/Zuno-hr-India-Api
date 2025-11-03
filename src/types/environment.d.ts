declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: 'development' | 'production' | 'test';
      PORT: string;
      HOST: string;
      MONGODB_URI: string;
      JWT_SECRET: string;
      CORS_ORIGINS: string;
      GCP_STORAGE_BUCKET: string;
    }
  }
} 
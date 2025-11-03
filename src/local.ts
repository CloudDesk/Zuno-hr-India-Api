import { createApp } from './app';

const start = async () => {
  try {
    const server = await createApp();
    const port = process.env.PORT || 3000;
    const address = await server.listen({ port: Number(port), host: '0.0.0.0' });
    console.log(`Server listening at ${address}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start(); 
import express from 'express';
import cors from 'cors';
import { DAEMON_PORT, DAEMON_HOST, DAEMON_VERSION } from './config/constants';
import { logger } from './config/logger';
import healthRouter from './routes/health';
import modelsRouter from './routes/models';
import chatRouter from './routes/chat';

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Routes
app.get('/', (_req, res) => {
  res.json({ name: 'Studio Harness Provider Daemon', version: DAEMON_VERSION, status: 'running' });
});

app.use('/health', healthRouter);
app.use('/v1/models', modelsRouter);
app.use('/v1/chat', chatRouter);

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('server', 'Unhandled error', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
const server = app.listen(DAEMON_PORT, DAEMON_HOST, () => {
  logger.info('server', `Local provider daemon listening on ${DAEMON_HOST}:${DAEMON_PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('server', 'SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('server', 'Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('server', 'SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('server', 'Server closed');
    process.exit(0);
  });
});

export default server;

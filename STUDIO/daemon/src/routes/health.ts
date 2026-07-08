import { Router } from 'express';
import { DaemonHealth } from '../types/index';
import { DAEMON_PORT, DAEMON_VERSION } from '../config/constants';
import { modelRegistry } from '../services/localModelRegistry';
import { logger } from '../config/logger';

const router = Router();
const startTime = Date.now();

router.get('/', async (req, res) => {
  try {
    const providers = await modelRegistry.getProviderStatus();
    const models = await modelRegistry.getModels();

    const health: DaemonHealth = {
      running: true,
      port: DAEMON_PORT,
      providers: {
        ollama: providers['ollama'] || false,
        lmstudio: providers['lmstudio'] || false,
      },
      models: models.length,
      uptime: Date.now() - startTime,
    };

    res.json(health);
  } catch (error) {
    logger.error('health', 'Health check failed', error);
    res.status(500).json({ running: false, error: 'Health check failed' });
  }
});

export default router;

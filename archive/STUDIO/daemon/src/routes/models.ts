import { Router } from 'express';
import { modelRegistry } from '../services/localModelRegistry';
import { logger } from '../config/logger';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const models = await modelRegistry.getModels(forceRefresh);

    res.json({
      data: models,
      object: 'list',
      count: models.length,
    });

    logger.info('models', `Returned ${models.length} models`);
  } catch (error) {
    logger.error('models', 'Failed to fetch models', error);
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

export default router;

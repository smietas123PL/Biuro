import 'dotenv/config';
import { db } from './db/client.js';
import { logger } from './utils/logger.js';
import { startOrchestrator } from './orchestrator/scheduler.js';
import { runtimeRegistry } from './runtime/registry.js';
import { ClaudeRuntime } from './runtime/claude.js';
import { OpenAIRuntime } from './runtime/openai.js';

async function initWorker() {
  logger.info('Starting Autonomiczne Biuro Worker...');

  try {
    // 1. Check DB
    await db.query('SELECT 1');
    logger.info('Worker connected to Database');

    // 2. Runtimes are auto-registered in RuntimeRegistry constructor

    // 3. Start Scheduler
    startOrchestrator();
    
    logger.info('Worker execution loop heartbeat started');
  } catch (err) {
    logger.error({ err }, 'Worker failed to start');
    process.exit(1);
  }
}

initWorker();

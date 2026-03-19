import { db } from '../db/client.js';
import {
  runEmbeddingBackfill,
  type EmbeddingBackfillOptions,
} from '../services/embeddingBackfill.js';
import { logger } from '../utils/logger.js';

function parseArgs(argv: string[]): EmbeddingBackfillOptions {
  const options: EmbeddingBackfillOptions = {};

  for (const arg of argv) {
    if (arg === '--only-missing') {
      options.onlyMissing = true;
      continue;
    }

    if (arg.startsWith('--batch-size=')) {
      const value = Number(arg.split('=')[1]);
      if (Number.isFinite(value)) {
        options.batchSize = value;
      }
      continue;
    }

    if (arg === '--knowledge-only') {
      options.targets = ['knowledge'];
      continue;
    }

    if (arg === '--memory-only') {
      options.targets = ['memory'];
      continue;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  logger.info({ options }, 'Starting embeddings backfill');

  const summary = await runEmbeddingBackfill(options);
  logger.info({ summary }, 'Embeddings backfill completed');
}

main()
  .catch((err) => {
    logger.error({ err }, 'Embeddings backfill failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });

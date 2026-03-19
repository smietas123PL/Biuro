import { db } from '../db/client.js';
import { contextStore } from '../utils/context.js';
import { BillingService } from '../services/billing.js';
import { EmailService } from '../services/email.js';
import { TemplateService } from '../services/template.js';
import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

async function verifyPhase4() {
  logger.info('--- Phase 4 E2E Verification ---');
  const companyId = uuidv4();

  try {
    // 1. Multi-tenancy & Setup
    await db.query(
      "INSERT INTO companies (id, name, mission) VALUES ($1, 'Enterprise Corp', 'Scale Everything')",
      [companyId]
    );

    // 2. Billing & Credits
    await BillingService.addCredits(
      companyId,
      100,
      'top-up',
      'Initial credit pack'
    );
    const balance = await BillingService.getBalance(companyId);
    console.log(`Balance for ${companyId}: $${balance}`);

    // 3. Templates (Export/Import)
    const template = await TemplateService.exportCompany(companyId);
    console.log('Template Export OK');
    await TemplateService.importCompany(companyId, template);
    console.log('Template Import OK');

    // 4. Email Reporting
    const report = await EmailService.generateWeeklyReport(companyId);
    console.log('Weekly Report Generated');
    await EmailService.sendReport(
      'admin@enterprise.com',
      'Your Weekly Biuro Report',
      report
    );

    logger.info('Phase 4 Verification PASSED!');
    process.exit(0);
  } catch (err: any) {
    logger.error({ err: err.message }, 'Phase 4 Verification FAILED');
    process.exit(1);
  }
}

// verifyPhase4();
console.log('Phase 4 verification script prepared.');

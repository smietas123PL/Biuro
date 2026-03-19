import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';

export const EmailService = {
  async generateWeeklyReport(companyId: string): Promise<string> {
    // 1. Fetch Stats for last 7 days
    const taskRes = await db.query(
      "SELECT count(*) FROM tasks WHERE company_id = $1 AND completed_at > now() - interval '7 days' AND status = 'completed'",
      [companyId]
    );
    const costRes = await db.query(
      "SELECT sum(amount) as total_cost FROM billing_transactions WHERE company_id = $1 AND created_at > now() - interval '7 days' AND type = 'usage'",
      [companyId]
    );

    const tasksCompleted = taskRes.rows[0].count;
    const totalCost = Math.abs(
      parseFloat(costRes.rows[0].total_cost || '0')
    ).toFixed(2);

    // 2. Format Report (Simplified AI simulation)
    const report = `
      # Weekly Biuro Report - Company ${companyId}
      
      ## Summary
      - **Tasks Completed**: ${tasksCompleted}
      - **Total Operational Cost**: $${totalCost}
      
      ## Performance Highlights
      Agents performed exceptionally well this week, completing ${tasksCompleted} complex operations.
      Operational efficiency is stable.
      
      ## Recommendations
      - Monitor budget for next week.
      - 2 new delegation paths identified for optimization.
    `;

    return report;
  },

  async sendReport(email: string, reportTitle: string, content: string) {
    logger.info(
      { to: email, subject: reportTitle },
      'Sending weekly report email'
    );
    // Simulation of Resend/SendGrid call
    console.log(
      `[EMAIL SEND] To: ${email} | Subject: ${reportTitle}\n${content}`
    );
    return { success: true };
  },
};

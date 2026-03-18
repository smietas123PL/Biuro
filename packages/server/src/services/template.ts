import { db } from '../db/client.js';

export const TemplateService = {
  async exportCompany(companyId: string) {
    // 1. Get Company Info
    const company = (await db.query("SELECT name, mission FROM companies WHERE id = $1", [companyId])).rows[0];
    
    // 2. Get Agents
    const agents = (await db.query("SELECT name, role, runtime, description, system_prompt FROM agents WHERE company_id = $1", [companyId])).rows;
    
    // 3. Get Roles (Schema doesn't have a formal roles table, we use user_roles role column)
    // For now, we'll export the set of roles defined in user_roles
    const roles = (await db.query("SELECT DISTINCT role FROM user_roles WHERE company_id = $1", [companyId])).rows.map(r => r.role);

    return {
      version: '1.0',
      company: {
        name: company.name,
        mission: company.mission
      },
      agents: agents.map(a => ({
          name: a.name,
          role: a.role,
          runtime: a.runtime,
          description: a.description,
          system_prompt: a.system_prompt
      })),
      roles
    };
  },

  async importCompany(companyId: string, template: any) {
    return db.transaction(async (client) => {
      // 1. Update company name/mission if needed
      await client.query(
        "UPDATE companies SET name = $1, mission = $2 WHERE id = $3",
        [template.company.name, template.company.mission, companyId]
      );

      // 2. Recreate agents
      for (const agent of template.agents) {
        await client.query(
          "INSERT INTO agents (company_id, name, role, runtime, description, system_prompt) VALUES ($1, $2, $3, $4, $5, $6)",
          [companyId, agent.name, agent.role, agent.runtime, agent.description, agent.system_prompt]
        );
      }
      
      return { success: true, agentsImported: template.agents.length };
    });
  }
};

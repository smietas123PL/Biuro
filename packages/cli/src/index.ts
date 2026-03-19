#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';

import { client, config } from './api/client.js';

const program = new Command();

program
  .name('biuro')
  .description('CLI for Autonomiczne Biuro')
  .version('1.0.0');

program
  .command('login')
  .description('Login to Biuro')
  .argument('<email>', 'User email')
  .argument('<password>', 'User password')
  .option('-c, --company <id>', 'Specific Company ID')
  .action(async (email, password, options) => {
    try {
      const res = await client.post('/auth/login', { email, password });
      const token = res.data.token;
      config.set('token', token);
      if (options.company) config.set('companyId', options.company);
      
      console.log(chalk.green('Successfully logged in!'));
      if (!options.company) console.log(chalk.yellow('Note: Set company ID via -c or biuro set-company <id>'));
    } catch (err: any) {
       console.error(chalk.red('Login failed:'), err.response?.data?.error || err.message);
    }
  });

program
  .command('status')
  .description('Show current status')
  .action(async () => {
    try {
      const res = await client.get('/companies');
      console.log(chalk.cyan('--- Biuro Status ---'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (err: any) {
      console.error(chalk.red('Status failed:'), err.response?.data?.error || err.message);
    }
  });

program
  .command('logs')
  .description('Stream logs from an agent')
  .argument('[agentId]', 'ID of the agent')
  .action(async (agentId) => {
    console.log(chalk.yellow(`Streaming logs for agent: ${agentId || 'all'}...`));
    // Polling simulation for now
    setInterval(async () => {
       try {
         const res = await client.get('/audit', { params: { agentId, limit: 1 } });
         if (res.data.length > 0) {
           const log = res.data[0];
           console.log(chalk.gray(`[${log.created_at}]`), chalk.white(log.action), log.details);
         }
       } catch (err) {}
    }, 5000);
  });

program
  .command('deploy')
  .description('Deploy a company template')
  .argument('<path>', 'Path to template JSON')
  .action(async (path) => {
     try {
       const fs = await import('node:fs/promises');
       const template = JSON.parse(await fs.readFile(path, 'utf8'));
       const res = await client.post('/templates/import', template);
       console.log(chalk.green('Successfully deployed template:'), res.data);
     } catch (err: any) {
       console.error(chalk.red('Deployment failed:'), err.response?.data?.error || err.message);
     }
  });

await program.parseAsync(process.argv);

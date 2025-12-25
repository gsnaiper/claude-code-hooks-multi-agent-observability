#!/usr/bin/env node
import { Command } from 'commander';
import { Agent } from './agent.js';

const program = new Command();

program
  .name('ccc-agent')
  .description('Remote agent for Claude Code terminal gateway')
  .version('1.0.0');

program
  .command('start')
  .description('Start the agent daemon')
  .option('-g, --gateway <url>', 'Gateway WebSocket URL', 'wss://cli.di4.dev/agent')
  .option('-i, --agent-id <id>', 'Agent ID', process.env.CCC_AGENT_ID)
  .option('-s, --secret <secret>', 'Agent secret', process.env.CCC_AGENT_SECRET)
  .option('--poll-interval <ms>', 'Tmux poll interval', '5000')
  .action(async (options) => {
    if (!options.agentId || !options.secret) {
      console.error('Error: Agent ID and secret are required');
      console.error('Set CCC_AGENT_ID and CCC_AGENT_SECRET environment variables');
      console.error('Or use --agent-id and --secret options');
      process.exit(1);
    }

    const agent = new Agent({
      gatewayUrl: options.gateway,
      agentId: options.agentId,
      agentSecret: options.secret,
      pollInterval: parseInt(options.pollInterval),
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => agent.stop());
    process.on('SIGTERM', () => agent.stop());

    await agent.start();
  });

program
  .command('register')
  .description('Register this agent with the gateway')
  .option('-g, --gateway <url>', 'Gateway HTTP URL', 'https://cli.di4.dev')
  .action(async (options) => {
    console.log('Registration not yet implemented');
    console.log('Set CCC_AGENT_ID and CCC_AGENT_SECRET environment variables');
  });

program.parse();

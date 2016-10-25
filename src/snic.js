'use strict';

const configManager = require('./config');
const aliases = require('./aliases');

const commands = {
  install: require('./commands/install')
};

async function main(argv) {
  //await configManager.load();
  argv.shift();
  if (argv.length > 0 && argv[0].endsWith('snic.js')) {
    argv.shift();
  }
  if (argv.length === 0) {
    throw new Error('No command specified!');
  }
  if (aliases[argv[0]]) {
    const alias = argv.shift();
    argv = [...aliases[alias], ...argv];
  }
  const command = argv.shift();
  if (!commands.hasOwnProperty(command)) {
    throw new Error(`No such command: ${command}.`);
  }
  commands[command].run(...argv);
}

main(process.argv).catch(e => console.error(e.stack));

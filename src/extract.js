'use strict';

const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));
const child_process = Promise.promisifyAll(require('child_process'));
const { mkdirpAsync } = require('./helpers');

async function list(file) {
  const tar = await child_process.execFileAsync(
    'tar',
    ['--list', '--warning=no-unknown-keyword', '-f', file],
    { maxBuffer: 50 * 1024 * 1024 }
  );
  return tar.split('\n')
            .filter(x => !!x)
            .sort();
}

async function extract(filename, dir) {
  const file = await fs.realpathAsync(filename);

  const lines = await list(file);
  if (!lines.every(x => x.indexOf('/') !== -1)) {
    throw new Error('Package contains top-level files!');
  }

  await mkdirpAsync(dir);
  const args = [
    '--strip-components=1',
    '--warning=no-unknown-keyword',
    '-xf',
    file
  ];
  await child_process.execFileAsync('tar', args, {
    cwd: dir,
    stdio: 'ignore',
    maxBuffer: 50 * 1024 * 1024
  });
}

module.exports = {
  extract
};

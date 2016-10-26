'use strict';

const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));
const path = require('path');
const crypto = require('crypto');
const bhttp = require('bhttp');
const assert = require('assert');
const { mkdirpAsync, promiseEvent } = require('./helpers');
const { config } = require('./config');

const session = bhttp.session({
  headers: {
    'user-agent': 'snic'
  }
});

let hasDir = false;

async function download(info) {
  const cacheDir = path.join(config.cache, 'packages');
  if (!hasDir) {
    await mkdirpAsync(cacheDir);
    hasDir = true;
  }

  const filename = info.dist.tarball.split('/').pop();
  assert(/^[a-zA-Z0-9][a-zA-Z0-9_.\-]*\.tgz$/.test(filename));
  const file = path.join(cacheDir, filename);
  info.package = file;

  try {
    await checkHash(file, info);
  } catch (e) {
    console.log(`Downloading: ${file}...`);
    const out = fs.createWriteStream(file);
    const response = await session.get(info.dist.tarball, { stream: true });
    response.pipe(out);
    await promiseEvent(response);
    //await promiseEvent(out);
    await checkHash(file, info);
  }
}

async function checkHash(file, info) {
  const hash = crypto.createHash('sha1');
  const input = fs.createReadStream(file);
  input.pipe(hash);
  await promiseEvent(input);
  await promiseEvent(hash, 'readable');
  if (info.dist.shasum !== hash.read().toString('hex')) {
    throw new Error('Hash mismatch for ' + file);
  }
}

module.exports = download;

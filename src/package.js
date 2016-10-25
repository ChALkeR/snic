'use strict';

const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));

async function locate(dir) {
  return './package.json';
}

async function read(dir) {
  const file = await locate(dir);
  const content = await fs.readFileAsync(file, 'utf-8');
  return JSON.parse(content);
}

module.exports = {
  locate,
  read
};

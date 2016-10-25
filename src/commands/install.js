'use strict';

const Promise = require('bluebird');
const path = require('path');
const resolve = require('../resolve');
const download = require('../download');

async function run(...packages) {
  console.log(`installing ${packages}...`);
  if (packages.length === 0) {
    await installProject();
  } else {
    await installPackages(packages);
  }
}

async function installProject() {
}

async function installPackages(packages) {
  const tree = buildTree(packages);
}

async function buildTree(packages) {
  let remaining = packages.map(specifier => specifier.split('@'));
  const data = new Map();
  const versions = new Map();
  while (remaining.length > 0) {
    const resolved = await Promise.map(
      remaining,
      args => resolve(...args), 
      {concurrency: 20}
    );
    for (const i in remaining) {
      const spec = remaining[i].join('@')
      const row = resolved[i];
      const res = `${row.name}@${row.version}`;
      versions.set(spec, res);
      data.set(res, row);
    }
    remaining = [].concat(...resolved.map(
      row => Object.keys(row.dependencies || {}).map(
        name => [name, row.dependencies[name]]
      ).filter(spec => !versions.has(spec.join('@')))
    ));
  }
  for (const [spec, res] of versions) {
    const row = data.get(res);
    await download(row);
  }
  console.log(versions);
}

module.exports = {
  run
};

'use strict';

const Promise = require('bluebird');
const path = require('path');
const resolve = require('../resolve');
const download = require('../download');
const { read } = require('../package');

async function run(...packages) {
  if (packages.length === 0) {
    await installProject();
  } else {
    const list = packages.map(specifier => specifier.split('@'));
    await installPackages(list);
  }
}

async function installProject(dir) {
  const info = await read(dir);
  const list = Object.keys(info.dependencies || {}).map(
    name => [name, info.dependencies[name]]
  );
  for (const name of Object.keys(info.devDependencies || {})) {
    if (info.dependencies[name]) {
      throw new Error(
        `Package can\'t be both in dependencies and devDependencies: ${name}.`
      );
    }
    list.push([name, info.devDependencies[name]]);
  }
  await installPackages(list);
}

async function installPackages(packages) {
  const tree = await buildTree(packages);
}

async function buildTree(packages) {
  let remaining = packages;
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
  console.log(versions);
  for (const [spec, res] of versions) {
    console.log(spec, res);
    const row = data.get(res);
    await download(row);
  }
  console.log('Done!');
}

module.exports = {
  run
};

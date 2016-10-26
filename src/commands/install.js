'use strict';

const Promise = require('bluebird');
const path = require('path');
const resolve = require('../resolve');
const download = require('../download');
const { read } = require('../package');
const { extract } = require('../extract');

async function run(...specs) {
  if (specs.length === 0) {
    await installProject();
  } else {
    const packages = specs.map(specifier => specifier.split('@'));
    await installPackages(packages);
  }
}

async function installProject(dir) {
  const info = await read(dir);
  const packages = Object.keys(info.dependencies || {}).map(
    name => [name, info.dependencies[name]]
  );
  for (const name of Object.keys(info.devDependencies || {})) {
    if (info.dependencies[name]) {
      throw new Error(
        `Package can\'t be both in dependencies and devDependencies: ${name}.`
      );
    }
    packages.push([name, info.devDependencies[name]]);
  }
  await installPackages(packages);
}

async function installPackages(packages) {
  const [data, versions] = await buildVersions(packages);

  const tree = await buildTree(packages, data, versions);

  for (const [, row] of data) {
    await download(row);
  }

  await extractTree(tree, data);
}

async function extractTree(tree, data, prefix = './') {
  const queue = [[tree, data, prefix]];
  let row;
  while (row = queue.shift()) {
    [ tree, data, prefix ] = row;
    for (const spec of Object.keys(tree)) {
      const info = data.get(spec);
      const dir = path.join(prefix, 'node_modules.snic', info.name);
      await extract(info.package, dir);
      queue.push([tree[spec], data, dir]);
    }
  }
}

async function buildTree(packages, data, versions) {
  const specs = packages.map(row => row.join('@'));
  const tree = {};

  // Add top-level packages
  for (const row of packages) {
    const spec = versions.get(row.join('@'));
    tree[spec] = {};
  }

  // Add no-conflicting packages
  const counts = new Map();
  const remaining = new Set();
  for (const [, row] of data) {
    counts.set(row.name, counts.get(row.name) || 0 + 1);
  }
  for (const [spec, row] of data) {
    const count = counts.get(row.name);
    if (count === 1) {
      tree[spec] = {};
    } else {
      remaining.set(spec, count);
    }
  }

  if (remaining.size === 0) {
    return tree;
  }
  console.log(remaining);

  console.log(tree);
}

async function buildVersions(packages) {
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
  return [data, versions];
}

module.exports = {
  run
};

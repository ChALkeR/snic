'use strict';

const Promise = require('bluebird');
const path = require('path');
const resolve = require('../resolve');
const download = require('../download');
const { read } = require('../package');
const { buildTree, extractTree } = require('../tree');

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

  await Promise.map(
    data,
    ([, row]) => download(row),
    {concurrency: 10}
  );

  await extractTree(tree, data);
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
      row => row._listDependencies.filter(
        spec => !versions.has(spec.join('@'))
      )
    ));
  }
  return [data, versions];
}

module.exports = {
  run
};

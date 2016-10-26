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

  await Promise.map(
    data,
    ([, row]) => download(row),
    {concurrency: 10}
  );

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
  const list = [];

  // Add top-level packages
  for (const row of packages) {
    const spec = versions.get(row.join('@'));
    tree[spec] = {};
  }

  // Add no-conflicting packages
  const counts = new Map();
  for (const [id, row] of data) {
    if (!counts.has(row.name)) {
      counts.set(row.name, new Set());
    }
    const subcounts = counts.get(row.name);
    subcounts.add(row.version);
  }

  for (const [spec, row] of data) {
    const count = counts.get(row.name);
    if (count.size === 1) {
      tree[spec] = {};
      counts.delete(row.name)
    }
  }

  if (counts.size === 0) {
    // Yay, the whole tree is flat, we got no conflicts!
    return tree;
  }

  // Ok, let's build the actual tree here.
  const processNode = (subtree, spec) => {
    const row = data.get(spec);
    const deps = row._listDependencies.filter(
      ([id]) => counts.has(id)
    );
    for (const dep of deps) {
      const resolved = versions.get(dep.join('@'));
      subtree[spec][resolved] = {};
    }
    processTree(subtree[spec]);
  };
  const processTree = (subtree) => {
    for (const spec of Object.keys(subtree)) {
      processNode(subtree, spec);
    }
  };

  processTree(tree);

  // TODO: dedupe further

  return tree;
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

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
      const dir = path.join(prefix, 'node_modules', info.name);
      await extract(info.package, dir);
      queue.push([tree[spec], data, dir]);
    }
  }
}

async function buildTree(packages, data, resolve) {
  /*
   What is important here are the dependency chains.

   We build everything into dependency chains, where one chain represents
   one leaf of the tree.

   The logic tries to minimize those chains.

   Chains are represented as strings of resolved package ids.
  */

  // Build a map from package id to package deps
  const deps = new Map();
  for (const [id, row] of data) {
    deps.set(id, row._listDependencies.map(
      dspec => resolve.get(dspec.join('@'))
    ));
  }

  // Build chains and chains index
  const chains = new Set();
  const names = new Map(); // name -> version

  const queue = [];
  // Queue top-level packages
  for (const spec of packages) {
    const id = resolve.get(spec.join('@'));
    queue.push([id]);
  }

  // Build the `names` structure
  let chain;
  while (chain = queue.shift()) {
    const id = chain[chain.length - 1];
    const [name, version] = id.split('@');
    if (!names.has(name)) {
      names.set(name, new Set());
    }
    const versions = names.get(name);
    versions.add(version);

    chains.add(chain.join(','));

    for (const did of deps.get(id)) {
      const [dname, dversion] = did.split('@');
      if (chain.includes(did)) {
        const same = chain.map(x => x.split('@')).filter(x => x[0] === dname);
        const last = same.pop()
        if (last[1] !== dversion) {
          throw new Error(`Unresolvable cycle: ${chain.join(',')},${did}`);
        }
        continue;
      }
      queue.push([...chain, did]);
    }
  }

  // Move all unique deps that have no other non-top deps to the top
  // Remove them from the dependency chains — those are resolved completely
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, versions] of names) {
      if (versions.size > 1) continue;
      for (const version of versions) {
        const id = `${name}@${version}`;
        if (deps.get(id).filter(did => !chains.has(did)).length > 0) continue;
        for (const schain of chains) {
          const chain = schain.split(',');
          if (chain.indexOf(id) > 0) {
            const nchain = chain.slice(chain.indexOf(id));
            chains.delete(schain);
            chains.add(nchain.join(','));
            changed = true;
          }
        }
      }
    }
  }

  // Move all unique deps to the top
  // Remove them from the dependency chains — those are resolved completely
  // WARNING: this is not optimal and breaks further optimizations, but this is
  // best we currently get
  for (const [name, versions] of names) {
    if (versions.size > 1) continue;
    for (const version of versions) {
      const id = `${name}@${version}`;
      for (const schain of chains) {
        const chain = schain.split(',');
        if (chain.indexOf(id) > 0) {
          const nchain = chain.slice(chain.indexOf(id));
          chains.delete(schain);
          chains.add(nchain.join(','));
        }
      }
    }
  }

  /*
  for (const schain of chains) {
    if (schain.indexOf(',') > -1) console.log(schain);
  }
  */

  // TODO: dedupe further

  // Convert chains to tree
  const tree = {};
  for (const chain of chains) {
    let pointer = tree;
    for (const spec of chain.split(',')) {
      if (!pointer[spec]) {
        pointer[spec] = {};
      }
      pointer = pointer[spec];
    }
  }

  return tree;
}

function processTree(tree, callback, ...args) {
  for (const spec of Object.keys(tree)) {
    const subtree = tree[spec];
    callback(subtree, spec, ...args);
    processTree(subtree, callback, ...args);
  }
};

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

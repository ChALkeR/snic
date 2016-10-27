'use strict';

const Promise = require('bluebird');
const path = require('path');
const resolve = require('./resolve');
const { extract } = require('./extract');

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
   one node of the tree.

   The logic tries to minimize those chains.

   Chains are represented as strings of resolved package ids.
  */

  // Build a map from package id to package deps
  const deps = new Map();
  for (const [id, row] of data) {
    deps.set(id, row._listDependencies.map(
      dspec => resolve.get(dspec.join('@'))
    ).filter(
      did => {
        const [dname, dversion] = did.split('@');
        const optional = (row.optionalDependencies || {})[dname];
        const ok = packageSupported(data.get(did));
        if (!ok) {
          if (optional) {
            console.log(
              `SKIPPING OPTIONAL DEPENDENCY: Unsupported platform for ${did}.`
            );
          } else {
            throw new Error(
              `CAN NOT INSTALL DEPENDENCY: Unsupported platform for ${did}.`
            );
          }
        }
        return ok;
      }
    ));
  }

  // Build chains and chains index
  const chains = new Set();
  const names = new Map(); // name -> version

  const queue = [];
  // Queue top-level packages
  for (const spec of packages) {
    const id = resolve.get(spec.join('@'));
    if (!packageSupported(data.get(id))) {
      throw new Error(
        `CAN NOT INSTALL PACKAGE: Unsupported platform for ${did}.`
      );
    }
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

  // Move most popular deps to the top
  // Remove them from the dependency chains — those are resolved completely
  // WARNING: this is not optimal and breaks further optimizations, but this is
  // best we currently get
  // WARNING: very unoptimal algorithm, it's 3:42 am here
  const counts = new Map();
  for (const schain of chains) {
    const chain = schain.split(',');
    const id = chain[chain.length - 1];
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const list = [];
  for (const [id, count] of counts) {
    if (count < 2) continue;
    list.push([count, id]);
  }
  list.sort((a, b) => {
    if (a[0] < b[0]) return 1;
    if (a[0] > b[0]) return -1;
    return 0;
  });
  for (const [, id] of list) {
    if (chains.has(id)) continue;
    const [name, version] = id.split('@');
    const prefix = `${name}@`;
    for (const schain of chains) {
      const chain = schain.split(',');
      const index = chain.indexOf(id);
      if (index <= 0) continue;
      //console.log(schain);
      let ok = true;
      for (let i = 0; i < index; i++) {
        if (chain[i].startsWith(prefix)) {
          // We have another version earlier than the current one
          ok = false;
        }
      }
      if (!ok) continue;
      for (let i = 0; i < index; i++) {
        const achain = [...chain.slice(0, i), prefix].join(',');
        const bchain = [...chain.slice(0, i), id].join(',');
        let found = false;
        for (const sschain of chains) {
          if (sschain.startsWith(achain) && !sschain.startsWith(bchain)) {
            found = true;
            break;
          }
        }
        if (found) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      //console.log('.');
      const nchain = chain.slice(chain.indexOf(id));
      chains.delete(schain);
      chains.add(nchain.join(','));
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

function packageSupported(info) {
  const os = 'linux';
  if (info.os && !info.os.includes(os)) {
    return false;
  }
  return true;
}

module.exports = {
  buildTree,
  extractTree
};

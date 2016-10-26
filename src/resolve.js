'use strict';

const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));
const path = require('path');
const assert = require('assert');
const bhttp = require('bhttp');
const semver = require('semver');
const { mkdirpAsync } = require('./helpers');
const { config } = require('./config');

const resolved = new Map();
const info = new Map();

const session = bhttp.session({
  headers: {
    'user-agent': 'snic'
  }
});

let hasDir = false;

async function getInfo(name) {
  if (info.has(name)) {
    return info.get(name);
  }
  assert(/^[a-zA-Z0-9][a-zA-Z0-9_.\-]*$/.test(name));

  const cacheDir = path.join(config.cache, 'meta');
  if (!hasDir) {
    await mkdirpAsync(cacheDir);
    hasDir = true;
  }
  const cacheFile = path.join(cacheDir, `${name}.json`);

  try {
    const json = await fs.readFileAsync(cacheFile);
    const now = Date.now() / 1000;
    const { time, headers, data } = JSON.parse(json);
    // WARNING: high number for testing only
    if (now - time <= 360000) { // TODO: check based on headers
      info.set(name, data);
      return data;
    }
  } catch (e) {}

  const url = `${config.registry}${name}`;
  const response = await session.get(url);

  const time = Date.now() / 1000;
  const headers = response.headers;
  const data = response.body;

  // No need to store this
  data.contributors = undefined;
  data.readme = undefined;
  for (const version in data.versions) {
    const row = data.versions[version];
    row.contributors = undefined;
    row.devDependencies = undefined;
    row._npmOperationalInternal = undefined;
  }

  const meta = { name, time, headers, data };
  await fs.writeFileAsync(cacheFile, JSON.stringify(meta));

  info.set(name, data);
  return data;
}

function matchVersion(info, spec) {
  // Try specific version
  if (info.versions[spec]) {
    return spec;
  }

  // Try tagname
  if (info['dist-tags'][spec]) {
    return info['dist-tags'][spec];
  }

  // Try latest
  const latest = info['dist-tags'].latest;
  if (!spec || semver.satisfies(latest, spec)) {
    return latest;
  }

  // Find optimal
  return Object.keys(info.versions)
    .sort(semver.rcompare)
    .find(version => semver.satisfies(version, spec));
};

async function resolve(name, spec) {
  const key = `${name}@${spec}`;
  if (resolved.has(key)) {
    return resolved.get(key);
  }

  const info = await getInfo(name);
  const version = matchVersion(info, spec);
  const data = info.versions[version];

  resolved.set(key, data);
  return resolved.get(key);
}

module.exports = resolve;

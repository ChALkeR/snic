'use strict';

const Promise = require('bluebird');
const bhttp = require('bhttp');
const semver = require('semver');
const { config } = require('./config');

const resolved = new Map();
const info = new Map();

const session = bhttp.session({
  headers: {
    'user-agent': 'snic'
  }
});

async function getInfo(name) {
  if (info.has(name)) {
    return info.get(name);
  }
  const url = `${config.registry}${name}`;
  const response = await session.get(url);
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

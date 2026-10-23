// Submits a processed TestFlight build for App Store review through the App Store Connect API.
// Used by .eas/workflows/app-store.yml. Credentials come from EAS environment variables, never the repo:
//   ASC_KEY_ID, ASC_ISSUER_ID  - from App Store Connect > Users and Access > Integrations > App Store Connect API
//   ASC_PRIVATE_KEY            - the AuthKey_XXXX.p8 contents, its base64, or a path to it (an EAS file variable)
// Optional: BUILD_NUMBER (defaults to the newest processed build), WHATS_NEW (release notes).
import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundleId = JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8')).expo.ios.bundleIdentifier;
const { ASC_KEY_ID: keyId, ASC_ISSUER_ID: issuerId, BUILD_NUMBER: buildNumber, WHATS_NEW: whatsNew } = process.env;
if (!keyId || !issuerId || !process.env.ASC_PRIVATE_KEY) {
  throw new Error('Set ASC_KEY_ID, ASC_ISSUER_ID and ASC_PRIVATE_KEY in the EAS production environment.');
}

function privateKey() {
  const v = process.env.ASC_PRIVATE_KEY.trim();
  if (v.startsWith('-----BEGIN')) return v.replace(/\\n/g, '\n');
  if (existsSync(v)) return readFileSync(v, 'utf8');
  return Buffer.from(v, 'base64').toString('utf8');
}

function token() {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${b64({ iss: issuerId, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' })}`;
  const sig = createSign('SHA256').update(data).sign({ key: privateKey(), dsaEncoding: 'ieee-p1363' });
  return `${data}.${sig.toString('base64url')}`;
}

async function asc(method, path, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const json = await res.json();
  if (!res.ok) {
    const detail = (json.errors || []).map(e => `${e.title}: ${e.detail}`).join('\n') || res.statusText;
    throw Object.assign(new Error(`${method} ${path} failed (${res.status})\n${detail}`), { status: res.status });
  }
  return json;
}

const app = (await asc('GET', `/v1/apps?filter[bundleId]=${bundleId}`)).data[0];
if (!app) throw new Error(`No App Store Connect app with bundle ID ${bundleId}.`);

const buildQuery = `/v1/builds?filter[app]=${app.id}&filter[processingState]=VALID&filter[expired]=false`
  + (buildNumber ? `&filter[version]=${buildNumber}` : '') + '&sort=-uploadedDate&limit=1&include=preReleaseVersion';
const builds = await asc('GET', buildQuery);
const build = builds.data[0];
if (!build) throw new Error(buildNumber ? `Build ${buildNumber} is not a processed, unexpired build.` : 'No processed builds found.');
const versionString = builds.included.find(i => i.type === 'preReleaseVersions').attributes.version;
console.log(`Submitting ${versionString} (${build.attributes.version}) of ${app.attributes.name}`);

// Reuse this version's App Store entry if it exists; otherwise create it.
const versions = await asc('GET', `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&filter[versionString]=${versionString}`);
let version = versions.data[0];
if (version) {
  const state = version.attributes.appVersionState || version.attributes.appStoreState;
  const editable = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY', 'READY_FOR_REVIEW'];
  if (!editable.includes(state)) {
    throw new Error(`Version ${versionString} is ${state}. Bump "version" in app.json and push a new TestFlight build.`);
  }
} else {
  version = (await asc('POST', '/v1/appStoreVersions', {
    data: {
      type: 'appStoreVersions',
      attributes: { platform: 'IOS', versionString, releaseType: 'AFTER_APPROVAL' },
      relationships: { app: { data: { type: 'apps', id: app.id } } },
    },
  })).data;
  console.log(`Created App Store version ${versionString}`);
}

await asc('PATCH', `/v1/appStoreVersions/${version.id}/relationships/build`, { data: { type: 'builds', id: build.id } });

if (whatsNew) {
  const locs = await asc('GET', `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
  for (const loc of locs.data) {
    await asc('PATCH', `/v1/appStoreVersionLocalizations/${loc.id}`, {
      data: { type: 'appStoreVersionLocalizations', id: loc.id, attributes: { whatsNew } },
    });
  }
}

// An app has at most one open review submission, so add to it rather than creating a second.
const open = await asc('GET', `/v1/reviewSubmissions?filter[app]=${app.id}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW`);
const submission = open.data[0] || (await asc('POST', '/v1/reviewSubmissions', {
  data: {
    type: 'reviewSubmissions',
    attributes: { platform: 'IOS' },
    relationships: { app: { data: { type: 'apps', id: app.id } } },
  },
})).data;

try {
  await asc('POST', '/v1/reviewSubmissionItems', {
    data: {
      type: 'reviewSubmissionItems',
      relationships: {
        reviewSubmission: { data: { type: 'reviewSubmissions', id: submission.id } },
        appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } },
      },
    },
  });
} catch (e) {
  if (e.status !== 409) throw e; // 409: the version is already in this submission
}

await asc('PATCH', `/v1/reviewSubmissions/${submission.id}`, {
  data: { type: 'reviewSubmissions', id: submission.id, attributes: { submitted: true } },
});
console.log(`Submitted ${versionString} (${build.attributes.version}) for App Store review. It releases automatically once approved.`);

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

import { build } from 'esbuild';

/**
 * Required-field messages in the settings UI (SPEC section 11.3): every "{Label} is required." message carries the
 * field's own label verbatim, taken from the same table the sections render the label from (`FIELD_LABELS` in
 * `homebridge-ui/src/copy.ts`), and every label in that table is what some field reports when it is left empty.
 * The page's validator and copy are bundled from source here, the way the UI build bundles them, and run on a
 * configuration with every required field empty.
 */

const ROOT = resolve(import.meta.dirname, '..', '..');

/** Bundles the validator, the copy and the model reader into one ESM file and imports it. */
async function loadUiModules() {
  const dir = mkdtempSync(join(tmpdir(), 'notify-switch-ui-copy-'));
  const entry = join(dir, 'entry.ts');
  writeFileSync(entry, [
    `export { validate } from ${JSON.stringify(join(ROOT, 'homebridge-ui', 'src', 'validate.ts'))};`,
    `export { FIELD_LABELS, SWITCH_EDITOR, VALIDATION } from ${JSON.stringify(join(ROOT, 'homebridge-ui', 'src', 'copy.ts'))};`,
    `export { readConfig } from ${JSON.stringify(join(ROOT, 'homebridge-ui', 'src', 'model.ts'))};`,
  ].join('\n'));
  const outfile = join(dir, 'ui.mjs');
  await build({ entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent' });
  return import(pathToFileURL(outfile).href);
}

/** A platform block with every required field empty, one provider per type (ntfy once per credential mode). */
const EVERYTHING_EMPTY = {
  platform: 'NotifySwitch',
  name: '',
  masterSwitch: { enabled: true, name: '' },
  providers: [
    { id: '', type: 'twilio', name: '', accountSid: '', apiKeySid: '', apiKeySecret: '', smsSenders: ['+16785550100'] },
    { id: 'smtp', type: 'smtp', name: 'Email', host: '', port: 465, security: 'ssl', username: '', password: '', from: { address: '' } },
    { id: 'telegram', type: 'telegram', name: 'Telegram', botToken: '' },
    { id: 'ntfy-token', type: 'ntfy', name: 'ntfy', server: '', auth: 'token', token: '' },
    { id: 'ntfy-basic', type: 'ntfy', name: 'ntfy 2', server: 'https://ntfy.sh', auth: 'basic', username: '', password: '' },
  ],
  // The group keeps its id so the switches below reach somebody and their messages are checked; the provider above has none.
  groups: [{ id: 'family', name: '', sms: ['+16785550101'], email: ['a@example.com'] }],
  switches: [
    // The shared Message, empty.
    { id: '6f1c2a9e-2b1c-4b8f-9d1e-0c5a1e2f3a4b', name: '', actions: [{ providerId: 'twilio', channel: 'sms', groups: ['family'], body: '' }] },
    // Customize per channel: differing bodies open it, and the empty SMS message reports under its own label.
    {
      id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', name: 'Two', actions: [
        { providerId: 'twilio', channel: 'sms', groups: ['family'], body: '' },
        { providerId: 'smtp', channel: 'email', groups: ['family'], body: 'Hello' },
      ],
    },
  ],
};

test('required messages: every "is required." message carries the field\'s own label, for every label in copy', async () => {
  const { validate, FIELD_LABELS, SWITCH_EDITOR, VALIDATION, readConfig } = await loadUiModules();
  assert.equal(VALIDATION.required('Master switch name'), 'Master switch name is required.');
  assert.equal(VALIDATION.required('Account SID'), 'Account SID is required.');
  assert.equal(VALIDATION.required('Name'), 'Name is required.');
  assert.equal(SWITCH_EDITOR.messageLabel, FIELD_LABELS.message, 'the shared Message field is labelled from the same table');

  const labels = new Set([...Object.values(FIELD_LABELS), ...Object.values(SWITCH_EDITOR.channelBody)]);
  const config = readConfig(EVERYTHING_EMPTY);
  // A stored ntfy server that is missing reads as the default; the field is emptied on the page, as a user clearing it does.
  config.providers[3].server = '';
  const issues = validate(config);
  const required = issues.filter((issue) => issue.message.endsWith(' is required.'));
  assert.ok(required.length >= labels.size, `at least one required message per label (${required.length} of ${labels.size})`);
  for (const issue of required) {
    const label = issue.message.slice(0, -' is required.'.length);
    assert.ok(labels.has(label), `"${issue.message}" at ${issue.path} names a field label from copy`);
    assert.equal(issue.message, VALIDATION.required(label));
  }
  const seen = new Set(required.map((issue) => issue.message));
  for (const label of Object.values(FIELD_LABELS)) {
    assert.ok(seen.has(`${label} is required.`), `an empty "${label}" field reports "${label} is required."`);
  }
  assert.ok(seen.has('SMS message is required.'), 'an empty per-channel message under Advanced reports under its own label');

  // Where the message lands, by field: the master switch and the platform name under Settings, and the fields that
  // read "Name is required." because they are labelled Name.
  const byPath = new Map(required.map((issue) => [issue.path, issue.message]));
  assert.equal(byPath.get('masterSwitch.name'), 'Master switch name is required.');
  assert.equal(byPath.get('name'), 'Name is required.');
  assert.equal(byPath.get('providers[0].name'), 'Name is required.');
  assert.equal(byPath.get('groups[0].name'), 'Name is required.');
  assert.equal(byPath.get('switches[0].name'), 'Name is required.');
  assert.equal(byPath.get('providers[0].accountSid'), 'Account SID is required.');
  assert.equal(byPath.get('providers[0].apiKeySid'), 'API Key SID is required.');
  assert.equal(byPath.get('providers[0].apiKeySecret'), 'API Key Secret is required.');
  assert.equal(byPath.get('providers[0].id'), 'ID is required.');
  assert.equal(byPath.get('providers[1].host'), 'Host is required.');
  assert.equal(byPath.get('providers[1].username'), 'Username is required.');
  assert.equal(byPath.get('providers[1].password'), 'Password is required.');
  assert.equal(byPath.get('providers[1].from.address'), 'From address is required.');
  assert.equal(byPath.get('providers[2].botToken'), 'Bot Token is required.');
  assert.equal(byPath.get('providers[3].server'), 'Server is required.');
  assert.equal(byPath.get('providers[3].token'), 'Access token is required.');
  assert.equal(byPath.get('providers[4].username'), 'Username is required.');
  assert.equal(byPath.get('providers[4].password'), 'Password is required.');
  assert.equal(byPath.get('switches[0].body'), 'Message is required.');
  assert.equal(byPath.get('switches[1].bodies.sms'), 'SMS message is required.');

  // The summary box entry is "{Card}: {message}", so it carries the same label; the label part never holds markup.
  for (const issue of required) {
    assert.match(issue.label, /^(Settings|Provider \d+( ".*")?|Group \d+( ".*")?|Switch \d+( ".*")?)$/);
  }

  // A filled-in value that does not look right gets the format message instead, never "is required.".
  const filled = validate(readConfig({
    ...EVERYTHING_EMPTY,
    providers: [
      { ...EVERYTHING_EMPTY.providers[0], accountSid: 'AC12', apiKeySid: 'nope' },
      { ...EVERYTHING_EMPTY.providers[1], from: { address: 'not-an-address' } },
      { ...EVERYTHING_EMPTY.providers[2], botToken: 'nope' },
      { ...EVERYTHING_EMPTY.providers[3], server: 'ntfy.sh' },
    ],
  }));
  const messageAt = (path) => filled.find((issue) => issue.path === path)?.message;
  assert.equal(messageAt('providers[0].accountSid'), VALIDATION.accountSid);
  assert.equal(messageAt('providers[0].apiKeySid'), VALIDATION.apiKeySid);
  assert.equal(messageAt('providers[1].from.address'), 'From address is not a valid email address.');
  assert.equal(messageAt('providers[2].botToken'), VALIDATION.botToken);
  assert.equal(messageAt('providers[3].server'), VALIDATION.ntfyServer);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildTemplateVariables, DEFAULT_TEMPLATE_FORMATS, formatDate, formatDateTime, formatTime, renderTemplate } from '../../dist/template.js';

/**
 * Template variables (SPEC section 5.6) under every time and date format (SPEC section 5.1): `{{time}}` in
 * 12-hour and 24-hour form, `{{date}}` as month/day/year, day/month/year and year-month-day, and `{{datetime}}`
 * as the two joined by one space, at midnight, five past midnight, noon, five past noon, 17:15 and 23:59.
 */

/** 8 September 2026 in the host's local zone, at the given hour and minute (and 30 seconds, which never show). */
const at = (hours, minutes) => new Date(2026, 8, 8, hours, minutes, 30);

const TIMES = [
  { when: at(0, 0), h12: '12:00 AM', h24: '00:00' },
  { when: at(0, 5), h12: '12:05 AM', h24: '00:05' },
  { when: at(12, 0), h12: '12:00 PM', h24: '12:00' },
  { when: at(12, 5), h12: '12:05 PM', h24: '12:05' },
  { when: at(17, 15), h12: '5:15 PM', h24: '17:15' },
  { when: at(23, 59), h12: '11:59 PM', h24: '23:59' },
];

const DATES = { mdy: '9/8/2026', dmy: '8/9/2026', ymd: '2026-09-08' };

test('template: {{time}} renders every hour in 12-hour form without a leading zero and in 24-hour form with one', () => {
  for (const { when, h12, h24 } of TIMES) {
    assert.equal(formatTime(when, '12h'), h12);
    assert.equal(formatTime(when, '24h'), h24);
  }
});

test('template: {{date}} renders mdy, dmy and ymd, and only ymd zero-pads', () => {
  const when = at(17, 15);
  for (const [format, expected] of Object.entries(DATES)) {
    assert.equal(formatDate(when, format), expected);
  }
  // A two-digit month and day are not padded in the slash forms and are padded in ymd either way.
  const december = new Date(2026, 11, 25, 9, 0);
  assert.equal(formatDate(december, 'mdy'), '12/25/2026');
  assert.equal(formatDate(december, 'dmy'), '25/12/2026');
  assert.equal(formatDate(december, 'ymd'), '2026-12-25');
});

test('template: {{datetime}} is the date, one space, the time, in every combination, without seconds', () => {
  for (const { when, h12, h24 } of TIMES) {
    for (const [dateFormat, date] of Object.entries(DATES)) {
      assert.equal(formatDateTime(when, { timeFormat: '12h', dateFormat }), `${date} ${h12}`);
      assert.equal(formatDateTime(when, { timeFormat: '24h', dateFormat }), `${date} ${h24}`);
      const vars = buildTemplateVariables('Water Leak Alert', { timeFormat: '24h', dateFormat }, when);
      assert.deepEqual(vars, { switchName: 'Water Leak Alert', time: h24, date, datetime: `${date} ${h24}` });
    }
  }
});

test('template: the defaults are 12-hour and month/day/year, and a rendered body uses them', () => {
  assert.deepEqual(DEFAULT_TEMPLATE_FORMATS, { timeFormat: '12h', dateFormat: 'mdy' });
  const vars = buildTemplateVariables('Leak', undefined, at(17, 15));
  assert.deepEqual(vars, { switchName: 'Leak', time: '5:15 PM', date: '9/8/2026', datetime: '9/8/2026 5:15 PM' });
  assert.equal(renderTemplate('{{switchName}} at {{time}} on {{date}} ({{datetime}}) {{unknown}}', vars),
    'Leak at 5:15 PM on 9/8/2026 (9/8/2026 5:15 PM) {{unknown}}');
});

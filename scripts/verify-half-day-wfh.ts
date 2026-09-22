import assert from 'node:assert/strict';
import { getExpectedWorkMinutes } from '../src/utilis/attendance-duration';
import {
  getRequestedWFHDays,
  getWFHOverlapConflict,
  normalizeWFHDuration,
} from '../src/utilis/wfh-policy';

const shiftStart = new Date('2026-09-03T03:30:00.000Z');
const shiftEnd = new Date('2026-09-03T12:30:00.000Z');

assert.equal(getExpectedWorkMinutes(shiftStart, shiftEnd), 540);
assert.equal(getExpectedWorkMinutes(shiftStart, shiftEnd, true), 270);
assert.equal(normalizeWFHDuration(undefined), 'full-day');
assert.equal(getRequestedWFHDays('half-day', 1), 0.5);
assert.equal(getRequestedWFHDays('full-day', 3), 3);
assert.match(getWFHOverlapConflict(
  { wfhDuration: 'half-day', halfDayType: 'first-half' },
  'half-day',
  'first-half',
  '11-09-2026'
), /Duplicate WFH request:.*First Half.*11-09-2026/);
assert.match(getWFHOverlapConflict(
  { wfhDuration: 'half-day', halfDayType: 'first-half' },
  'half-day',
  'second-half',
  '11-09-2026'
), /First Half.*11-09-2026.*Second Half.*Full Day/);
assert.match(
  getWFHOverlapConflict({}, 'half-day', 'second-half', '11-09-2026'),
  /Full Day.*11-09-2026/
);
assert.match(getWFHOverlapConflict(
  { wfhDuration: 'half-day', halfDayType: 'second-half' },
  'full-day',
  undefined,
  '11-09-2026'
), /Second Half.*11-09-2026.*Cancel.*Full Day/);

console.log('Half-day WFH policy verification passed.');

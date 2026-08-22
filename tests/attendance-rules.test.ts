import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyAttendance, findMatchingSchedule } from '../lib/utils/attendance-rules';

describe('attendance rules', () => {
  const day = new Date(2026, 7, 23, 0, 0, 0, 0);

  it('classifies early, late, and absent punches at threshold boundaries', () => {
    assert.deepEqual(classifyAttendance(new Date(2026, 7, 23, 6, 55), '07:00', day), {
      status: 'present', minutesLate: 0,
    });
    assert.deepEqual(classifyAttendance(new Date(2026, 7, 23, 7, 15), '07:00', day), {
      status: 'present', minutesLate: 15,
    });
    assert.deepEqual(classifyAttendance(new Date(2026, 7, 23, 7, 16), '07:00', day), {
      status: 'late', minutesLate: 16,
    });
    assert.deepEqual(classifyAttendance(new Date(2026, 7, 23, 7, 31), '07:00', day), {
      status: 'absent', minutesLate: 31,
    });
  });

  it('matches only a schedule on the same weekday and in its time window', () => {
    const schedules = [
      { id: 1, day_of_week: day.getDay(), start_time: '07:00', end_time: '07:45', class_id: 10 },
      { id: 2, day_of_week: (day.getDay() + 1) % 7, start_time: '07:00', end_time: '07:45', class_id: 11 },
    ];

    assert.equal(findMatchingSchedule(new Date(2026, 7, 23, 6, 30), schedules)?.id, 1);
    assert.equal(findMatchingSchedule(new Date(2026, 7, 23, 7, 46), schedules), null);
  });
});

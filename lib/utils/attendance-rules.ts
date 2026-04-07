export interface AttendanceClassification {
  status: 'present' | 'late' | 'absent';
  minutesLate: number;
}

export function classifyAttendance(
  punchTime: Date,
  scheduleStartTime: string,
  scheduleDate: Date,
  lateThresholdMin: number = 15,
  absentThresholdMin: number = 30
): AttendanceClassification {
  const [hours, minutes] = scheduleStartTime.split(':').map(Number);
  const scheduledTime = new Date(scheduleDate);
  scheduledTime.setHours(hours, minutes, 0, 0);

  const diffMs = punchTime.getTime() - scheduledTime.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin <= lateThresholdMin) {
    return { status: 'present', minutesLate: Math.max(0, diffMin) };
  }
  if (diffMin <= absentThresholdMin) {
    return { status: 'late', minutesLate: diffMin };
  }
  return { status: 'absent', minutesLate: diffMin };
}

export function findMatchingSchedule(
  punchTime: Date,
  schedules: Array<{ id: number; day_of_week: number; start_time: string; end_time: string; class_id: number }>
) {
  const dayOfWeek = punchTime.getDay();
  const punchMinutes = punchTime.getHours() * 60 + punchTime.getMinutes();

  return schedules.find((s) => {
    if (s.day_of_week !== dayOfWeek) return false;
    const [startH, startM] = s.start_time.split(':').map(Number);
    const [endH, endM] = s.end_time.split(':').map(Number);
    return punchMinutes >= startH * 60 + startM - 30 && punchMinutes <= endH * 60 + endM;
  }) || null;
}

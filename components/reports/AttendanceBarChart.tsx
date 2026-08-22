'use client';

import { memo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface AttendanceChartRow {
  grade_name: string;
  present: number;
  late: number;
  absent: number;
}

function AttendanceBarChart({ data }: { data: AttendanceChartRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={300} minWidth={320}>
      <BarChart data={data} layout="vertical">
        <XAxis type="number" />
        <YAxis dataKey="grade_name" type="category" width={100} />
        <Tooltip />
        <Legend />
        <Bar dataKey="present" name="حاضر" fill="#22c55e" stackId="a" />
        <Bar dataKey="late" name="متأخر" fill="#eab308" stackId="a" />
        <Bar dataKey="absent" name="غائب" fill="#ef4444" stackId="a" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default memo(AttendanceBarChart);

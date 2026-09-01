export type AcademicYearParts = {
  startYear: number;
  endYear: number;
};

export function parseAcademicYearName(value: string): AcademicYearParts | null {
  const match = /^(\d{4})-(\d{4})$/.exec(value.trim());
  if (!match) return null;

  const startYear = Number(match[1]);
  const endYear = Number(match[2]);
  if (!Number.isInteger(startYear) || endYear !== startYear + 1) return null;

  return { startYear, endYear };
}
export function getNextAcademicYearName(current: string): string {
  const parsed = parseAcademicYearName(current);
  if (parsed) return `${parsed.startYear + 1}-${parsed.endYear + 1}`;

  const now = new Date();
  const year = now.getUTCFullYear();
  return `${year}-${year + 1}`;
}

export function getDefaultAcademicYearDates(name: string): { startDate: string; endDate: string } {
  const parsed = parseAcademicYearName(name);
  if (!parsed) return { startDate: '', endDate: '' };
  return {
    startDate: `${parsed.startYear}-08-01`,
    endDate: `${parsed.endYear}-07-31`,
  };
}

export function rolloverConfirmation(name: string): string {
  return `فتح ${name}`;
}

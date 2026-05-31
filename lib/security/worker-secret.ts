import { timingSafeEqual } from 'crypto';

export function getWorkerSecret(): string {
  return (process.env.WORKER_SECRET || '').trim();
}

export function isValidWorkerSecret(provided: string | null | undefined): boolean {
  const expected = getWorkerSecret();
  const actual = (provided || '').trim();
  if (!expected || !actual) return false;

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export function isWorkerRequest(request: Request): boolean {
  return isValidWorkerSecret(request.headers.get('x-worker-secret'));
}

import ZKLib from 'zkteco-js';

export interface DeviceUser {
  uid: number;
  name: string;
  userId: string;
  role: number;
}

export interface RawAttendanceLog {
  uid: number;
  id: string;
  userId: string;
  state: number;
  timestamp: string;
}

export interface PushUsersResult {
  success: number;
  failed: number;
  errors: Array<{ studentId: string; name: string; error: string }>;
}

export class DeviceService {
  private zk: any;
  private ip: string;
  private port: number;
  private connected: boolean = false;

  constructor(ip: string, port: number = 4370, timeout: number = 5000) {
    this.ip = ip;
    this.port = port;
    this.zk = new ZKLib(ip, port, timeout, 4000);
  }

  async connect(): Promise<void> {
    await this.zk.createSocket();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    try {
      if (this.connected) {
        await this.zk.disconnect();
      }
    } catch {
      // Ignore disconnect errors to always clean up state
    } finally {
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Lightweight connectivity check; updates the connected flag. */
  async checkConnection(): Promise<boolean> {
    try {
      await this.zk.getInfo();
      this.connected = true;
      return true;
    } catch {
      this.connected = false;
      return false;
    }
  }

  async getDeviceInfo(): Promise<any> {
    this.ensureConnected();
    try {
      const [info, version, name, mac] = await Promise.all([
        this.zk.getInfo().catch(() => null),
        this.zk.getDeviceVersion().catch(() => null),
        this.zk.getDeviceName().catch(() => null),
        this.zk.getMacAddress().catch(() => null),
      ]);
      return {
        info,
        firmwareVersion: version,
        deviceName: name,
        macAddress: mac,
        userCount: info?.userCounts || 0,
        logCount: info?.logCounts || 0,
      };
    } catch (err) {
      this.connected = false;
      throw err;
    }
  }

  async syncTime(): Promise<void> {
    this.ensureConnected();
    try {
      await this.zk.setTime(new Date());
    } catch (err) {
      this.connected = false;
      throw err;
    }
  }

  async pushUser(deviceUid: number, userId: string, name: string): Promise<void> {
    this.ensureConnected();
    try {
      await this.zk.setUser(deviceUid, userId, name, '', 0, 0);
    } catch (err) {
      this.connected = false;
      throw err;
    }
  }

  async pushUsers(users: Array<{ device_uid: number; student_id: string; first_name: string; last_name: string }>): Promise<PushUsersResult> {
    let success = 0, failed = 0;
    const errors: PushUsersResult['errors'] = [];
    for (const u of users) {
      try {
        await this.pushUser(u.device_uid, u.student_id, `${u.first_name} ${u.last_name}`);
        success++;
      } catch (err) {
        failed++;
        errors.push({
          studentId: u.student_id,
          name: `${u.first_name} ${u.last_name}`,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { success, failed, errors };
  }

  async removeUser(deviceUid: number): Promise<void> {
    this.ensureConnected();
    try {
      await this.zk.deleteUser(deviceUid);
    } catch (err) {
      this.connected = false;
      throw err;
    }
  }

  async getDeviceUsers(): Promise<DeviceUser[]> {
    this.ensureConnected();
    try {
      const result = await this.zk.getUsers();
      return result?.data || [];
    } catch (err) {
      this.connected = false;
      throw err;
    }
  }

  async pullAttendanceLogs(): Promise<RawAttendanceLog[]> {
    this.ensureConnected();
    try {
      const result = await this.zk.getAttendances();
      return result?.data || [];
    } catch (err) {
      this.connected = false;
      throw err;
    }
  }

  async clearDeviceLogs(): Promise<void> {
    this.ensureConnected();
    try {
      await this.zk.clearAttendanceLog();
    } catch (err) {
      this.connected = false;
      throw err;
    }
  }

  private ensureConnected(): void {
    if (!this.connected) throw new Error('Device is not connected');
  }
}

// ---------------------------------------------------------------------------
// Global device pool (persists across API calls in same server process)
// ---------------------------------------------------------------------------

const MAX_POOL_SIZE = 50;
const POOL_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface PoolEntry {
  service: DeviceService;
  lastActivity: number; // Date.now() timestamp
}

const devicePool = new Map<number, PoolEntry>();

/** Remove pool entries that have exceeded the TTL. */
export function cleanupPool(): void {
  const now = Date.now();
  for (const [id, entry] of devicePool) {
    if (now - entry.lastActivity > POOL_TTL_MS) {
      entry.service.disconnect().catch(() => {});
      devicePool.delete(id);
    }
  }
}

export function getDeviceFromPool(deviceId: number): DeviceService | undefined {
  cleanupPool();
  const entry = devicePool.get(deviceId);
  if (entry) {
    entry.lastActivity = Date.now();
    return entry.service;
  }
  return undefined;
}

export async function addDeviceToPool(deviceId: number, service: DeviceService): Promise<void> {
  cleanupPool();

  // If this device ID already exists, disconnect the old connection first
  const existing = devicePool.get(deviceId);
  if (existing) {
    await existing.service.disconnect().catch(() => {});
    devicePool.delete(deviceId);
  }

  // Evict the oldest entry if we've hit the size limit
  if (devicePool.size >= MAX_POOL_SIZE) {
    let oldestId: number | null = null;
    let oldestTime = Infinity;
    for (const [id, entry] of devicePool) {
      if (entry.lastActivity < oldestTime) {
        oldestTime = entry.lastActivity;
        oldestId = id;
      }
    }
    if (oldestId !== null) {
      const oldEntry = devicePool.get(oldestId);
      if (oldEntry) {
        await oldEntry.service.disconnect().catch(() => {});
      }
      devicePool.delete(oldestId);
    }
  }

  devicePool.set(deviceId, { service, lastActivity: Date.now() });
}

export function removeDeviceFromPool(deviceId: number): void {
  const entry = devicePool.get(deviceId);
  if (entry) {
    entry.service.disconnect().catch(() => {});
    devicePool.delete(deviceId);
  }
}

export function getConnectedDeviceIds(): number[] {
  cleanupPool();
  const ids: number[] = [];
  devicePool.forEach((entry, id) => {
    if (entry.service.isConnected()) ids.push(id);
  });
  return ids;
}

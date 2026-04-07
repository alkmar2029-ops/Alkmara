declare module 'zkteco-js' {
  class ZKLib {
    constructor(ip: string, port: number, timeout: number, inactivityTimeout: number);
    createSocket(): Promise<void>;
    disconnect(): Promise<void>;
    getInfo(): Promise<{ userCounts: number; logCounts: number }>;
    getDeviceVersion(): Promise<string>;
    getDeviceName(): Promise<string>;
    getMacAddress(): Promise<string>;
    setTime(time: Date): Promise<void>;
    setUser(uid: number, id: string, name: string, password: string, role: number, cardno: number): Promise<void>;
    deleteUser(uid: number): Promise<void>;
    getUsers(): Promise<{ data: Array<{ uid: number; name: string; userId: string; role: number }> }>;
    getAttendances(): Promise<{ data: Array<{ uid: number; id: string; userId: string; state: number; timestamp: string }> }>;
    clearAttendanceLog(): Promise<void>;
  }
  export default ZKLib;
}

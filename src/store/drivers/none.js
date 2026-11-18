// Driver nul pentru modul local (demo): nu există stocare la distanță, `sync` rămâne în starea 'local'.
import { DriverError } from './driver-error.js';

export function createNoneDriver() {
  const no = () => Promise.reject(new DriverError('offline', 'Mod local: fără stocare la distanță.'));
  return { kind: 'none', list: no, read: no, create: no, update: no, remove: no };
}

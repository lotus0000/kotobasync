export interface AlarmsApi {
  get(name: string): Promise<unknown>
  create(name: string, info: { periodInMinutes: number }): Promise<void> | void
}

/** Chrome may drop alarms on browser restart; check every time the service worker starts. */
export async function ensureSyncAlarm(alarms: AlarmsApi): Promise<void> {
  if (!(await alarms.get('sync'))) await alarms.create('sync', { periodInMinutes: 1 })
}

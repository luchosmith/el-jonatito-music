// A single source of "now" so tests can freeze time (sleep lock, reminders, schedule).
let frozen: Date | null = null;

export const clock = {
  now(): Date {
    return frozen ? new Date(frozen) : new Date();
  },
  /** Test mode only: pass null to go back to real time. */
  set(d: Date | null) {
    frozen = d ? new Date(d) : null;
  },
};

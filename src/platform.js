/* Platform capabilities, told honestly.

   This app is a web build today and an iPhone app later. The gap between those
   two matters enormously for reminders, and the failure mode is ugly: a browser
   will happily accept a notification permission and then never fire the thing
   you scheduled, because the tab was closed when the time came. A reminder that
   silently does not arrive is worse than no reminder, because you stop checking.

   So every capability here reports what it can ACTUALLY do on the device it is
   running on, and the UI says so in plain words. Nothing pretends.

   When this becomes a native iOS app, only this file changes. The screens ask
   `capabilities()` what is possible and render accordingly, so wiring up
   UNUserNotificationCenter later is a change here and nowhere else.            */

export const isBrowser = typeof window !== "undefined";

export function isIOS() {
  if (!isBrowser) return false;
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && "ontouchend" in document);
}

/** Installed to the home screen rather than running in a browser tab. */
export function isStandalone() {
  if (!isBrowser) return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

export function notificationState() {
  if (!isBrowser || !("Notification" in window)) return "unsupported";
  return Notification.permission; // "granted" | "denied" | "default"
}

/**
 * What this device can really do, and the honest caveat for each.
 *
 * `scheduledWhileClosed` is the one that matters and it is false everywhere on
 * the web. The Notification Triggers API that would have made it true was never
 * shipped beyond an origin trial, and iOS has no equivalent at all. The app's
 * answer is to export .ics with alarms and let the phone's Calendar ring.
 */
export function capabilities() {
  const ios = isIOS();
  const standalone = isStandalone();
  const notif = notificationState();

  return {
    ios,
    standalone,
    notifications: notif !== "unsupported",
    notificationsGranted: notif === "granted",
    notificationState: notif,

    /* Notifications only fire while the app is actually running. */
    whileOpen: notif === "granted",
    scheduledWhileClosed: false,

    /* iOS refuses the Notification API outright unless the app was added to the
       home screen — in a Safari tab the constructor is simply absent. */
    needsInstallForNotifications: ios && !standalone,

    calendarExport: isBrowser && typeof Blob !== "undefined",
    appBlocking: false,

    note: ios
      ? standalone
        ? "Installed on iOS. Notifications work while the app is open. Nothing can wake it once it is closed, so the calendar export is what actually rings."
        : "On iOS, notifications only exist once the app is added to the Home Screen. Until then the calendar export is the only reminder that will reach you."
      : "Notifications work while the app is open. No browser can wake a closed app on a schedule, so the calendar export is what actually rings.",
  };
}

export async function requestNotifications() {
  if (!isBrowser || !("Notification" in window)) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/** Fire now. Returns false if it could not, rather than throwing into a click handler. */
export function notify(title, body, tag = "monarch") {
  if (!isBrowser || !("Notification" in window) || Notification.permission !== "granted") return false;
  try {
    new Notification(title, { body, tag, icon: "/icon-192.png", badge: "/icon-192.png" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fire at a wall-clock time today, if the app is still open when it arrives.
 *
 * Deliberately not persisted and deliberately not promised: a timer dies with
 * the page. Callers must treat this as a bonus on top of the calendar export,
 * never as the mechanism a reminder depends on.
 */
export function scheduleWhileOpen(hhmm, title, body, tag) {
  if (!isBrowser) return () => {};
  const [h, m] = String(hhmm).split(":").map(Number);
  const when = new Date();
  when.setHours(h || 0, m || 0, 0, 0);
  const delay = when.getTime() - Date.now();
  if (delay <= 0 || delay > 20 * 60 * 60 * 1000) return () => {};
  const id = setTimeout(() => notify(title, body, tag), delay);
  return () => clearTimeout(id);
}

/**
 * Blocking another app is not something a web page can do, on any platform, by
 * any mechanism. Saying so here keeps the claim in one place, and gives the
 * screen something accurate to render instead of a button that does nothing.
 */
export const BLOCKING_REALITY = {
  web: {
    possible: false,
    why: "A web page is sandboxed to its own tab. It cannot see, let alone close, another app or site.",
  },
  ios: {
    possible: true,
    how: "Apple's Screen Time frameworks — FamilyControls, ManagedSettings and DeviceActivity. This is how Opal and one sec block Instagram.",
    catch: "Requires a native app and a FamilyControls entitlement granted by Apple on request. It cannot be done from a web view.",
  },
  stopgap: {
    ios: "Settings → Screen Time → App Limits. Set Instagram and Chess to a daily limit; add them to Downtime for a hard window.",
    android: "Settings → Digital Wellbeing → App timers, or Focus Mode for a scheduled block.",
    desktop: "A blocking extension with declarativeNetRequest rules, or an /etc/hosts entry.",
  },
};

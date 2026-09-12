# MONARCH — Research Scout Notes

Compiled 2026-08-31. Target platform re-scoped mid-research: **the real deliverable is an iOS app on the owner's iPhone.** The web PWA is a stopgap. Findings below are ordered accordingly.

Legend:
- **[V]** Verified against a primary or strong secondary source, URL given.
- **[I]** Inferred — reasoning stated, not directly sourced.
- **[THIN]** Evidence is weak or second-hand. Test before betting on it.

---

# PART 1 — iOS NOTIFICATION REALITY

## 1.1 What an installed PWA on iOS can and cannot do

**[V] Scheduled/repeating LOCAL notifications while the app is closed: NOT POSSIBLE on iOS Safari / iOS PWA. Full stop.**

- Safari supports **Web Push only**, not the local Notification scheduling primitives. Notifications created with `new Notification()` / `registration.showNotification()` only appear while the web app is actually running in the foreground; they do not fire when the PWA is backgrounded or closed.
  - Source: https://developer.apple.com/forums/thread/735402 ("Upcoming Support for Background Notifications in PWAs on Safari?")
  - Source: https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide
- **[V] Notification Triggers API (`showTrigger` / `TimestampTrigger`) is dead everywhere, not just iOS.** Google's own docs carry a banner: *"The development of Notification Triggers API, part of Google's capabilities project, has ended. It wasn't clear that we could provide consistent and reliable experiences across platforms."* It ran an origin trial (Chrome 80-era, 2019–2020), never launched, and is filed under "No longer pursuing." Safari never implemented it.
  - Source: https://developer.chrome.com/docs/web-platform/notification-triggers
  - Explainer (archived proposal): https://github.com/beverloo/notification-triggers
  - Stated reasons for abandonment include that there was no way to prune stale scheduled notifications without an open tab, Periodic Background Sync could not run at a sufficient cadence for it, and Push API was unsuitable because it mandates showing a notification.
- **[V] Web Periodic Background Sync is Chromium-only and irrelevant on iOS.** Safari and Safari iOS: no support at any version (3.1–27 / 3.2–26.6 in the compat table). Firefox: none.
  - Source: https://caniuse.com/mdn-api_periodicsyncmanager
  - Source: https://developer.mozilla.org/en-US/docs/Web/API/Web_Periodic_Background_Synchronization_API — labelled "Limited availability… not Baseline" and "Experimental", spec lives at WICG not W3C.
  - Even where it works (Chrome/Edge/Android), it is useless as an alarm: it requires the PWA to be installed and launched as a distinct app, will not fire at all unless the Chrome **site engagement score is > 0**, and *"The timing of synchronizations are not controlled by developers."* `minInterval` is a floor hint, never a guarantee. Source: https://developer.chrome.com/docs/capabilities/periodic-background-sync

**[V] What DOES work in an iOS PWA: Web Push, and only Web Push.**

- Requires **iOS/iPadOS 16.4+**.
- Requires the site be **added to the Home Screen** (Share → Add to Home Screen) and opened as a standalone web app. Web push does not work in the Safari tab on iPhone.
- Permission prompt must be triggered from a **user gesture** (a tap handler). You cannot auto-prompt on load.
- Requires `manifest.json` with `"display": "standalone"` (or `fullscreen`).
  - Sources: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ , https://pushpad.xyz/blog/ios-special-requirements-for-web-push-notifications , https://documentation.onesignal.com/docs/en/web-push-for-ios
- **[V] Web Push requires a server.** The device cannot push to itself. Delivery is: your backend holds the `PushSubscription`, signs a VAPID JWT with a private key, and POSTs to the push service endpoint (Apple's APNs-backed web push gateway for iOS). The private key must never be in client code.
  - Source: https://pqvst.com/2023/11/21/web-push-notifications/
  - **This is the killer for MONARCH's stated "local-first" constraint**: any PWA daily reminder implies a persistent server that knows the schedule and fires at the right minute. That is a backend, a cron, and a subscription store.
- **[V] Safari 18.4 / iOS 18.4 added Declarative Web Push** — notifications declared as JSON, no Service Worker required. This makes implementation simpler and cheaper on battery. **It does not remove the server requirement**; it changes what the server sends, not who sends it.
  - Source: https://webkit.org/blog/16535/meet-declarative-web-push/
  - Source: https://webkit.org/blog/16574/webkit-features-in-safari-18-4/

### Verdict for the PWA stopgap
The only working daily-reminder path in the web build is: backend + VAPID + scheduled push. Cost: a small always-on server or a scheduled serverless function (a Netlify scheduled function would work — the repo already has `netlify/` and `netlify.toml`), a subscription store, and a key pair. **Catch:** it is exactly the "not local-first" thing the project is trying to avoid, it silently breaks when a subscription 410s, and it is throwaway work once the native app exists.

---

## 1.2 Native iOS — the thing that actually works

**[V] `UNUserNotificationCenter` + `UNCalendarNotificationTrigger` gives real, repeating, server-free, offline local notifications that fire with the app closed or killed.**

- You build `DateComponents` with only the fields you want matched. Setting `hour = 6`, `minute = 0` and `repeats: true` means "06:00 every day, forever." Add `weekday` for weekly. Add `day` for monthly.
- Entirely on-device. No network, no APNs, no backend, no account.
  - Sources: https://www.donnywals.com/scheduling-daily-notifications-on-ios-using-calendar-and-datecomponents/ , https://www.hackingwithswift.com/read/21/2/scheduling-notifications-unusernotificationcenter-and-unnotificationrequest , https://www.createwithswift.com/notifications-tutorial-creating-and-scheduling-user-notifications-with-async-await/

**Permission flow [V]:**
1. Call `UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])`. This shows the system prompt.
2. No Info.plist usage-description string is required for notifications (unlike calendar/camera/etc.).
3. If denied, you cannot re-prompt — you can only deep-link to Settings.
4. Schedule via `UNNotificationRequest(identifier:content:trigger:)` and `add(_:)`. Use a **stable, deterministic identifier per quest** so re-adding replaces rather than duplicates.

**[V] THE HARD LIMIT — 64 pending requests per app.** iOS keeps only the **soonest-firing 64** `UNNotificationRequest`s and silently discards the rest. A single repeating request counts as **one**, no matter how many times it fires.
  - Sources: https://developer.apple.com/forums/thread/811171 , https://developer.apple.com/forums/thread/765490 , https://github.com/MaikuB/flutter_local_notifications/issues/2312
  - **Design consequence for MONARCH:** model recurring quests as *one repeating trigger each*, never as "pre-schedule the next 30 days." 64 repeating daily quests is fine; 64 quests × 30 days is not. Keep an explicit budget and call `getPendingNotificationRequests` to audit.

**Known iOS notification gotchas [V/THIN]:**
- **[V]** `UNCalendarNotificationTrigger` does not re-evaluate on timezone change in some wrapper implementations — Capacitor has an open issue on exactly this: https://github.com/ionic-team/capacitor-plugins/issues/2361
- **[THIN]** Reports of scheduled notifications going missing across DST transitions: https://developer.apple.com/forums/thread/115612 . Mitigation is to reschedule on `NSSystemTimeZoneDidChange` / `significantTimeChange`.
- **[I]** Notifications are the *only* reliable way for the app to reach the owner when closed. Background execution (`BGTaskScheduler`) is opportunistic and cannot be relied on for a "penalty applied at midnight" mechanic. Compute penalties **lazily on next launch** from stored timestamps, and use a notification purely as the nudge.

**Build cost:** trivial. A `UNCalendarNotificationTrigger` scheduler is ~100 lines of Swift, or zero Swift if using Capacitor's official plugin (see §4).

---

# PART 2 — iOS APP BLOCKING (the key question)

## 2.1 Plain statement of what is possible

**[V] A web app — PWA, hosted page, anything running in a browser — CANNOT block another app or website on the same device. There is no browser API for this on any platform.** This is not an iOS quirk; the web sandbox has no cross-application authority anywhere.

**[V] A native iOS app CAN block other apps and websites, using Apple's Screen Time API.** This is exactly how Opal, one sec, and Freedom do it — they use the same public frameworks Apple ships to every developer, not private APIs.
  - Sources: https://waittounlock.com/blog/screen-time-vs-app-blockers , https://tutorials.one-sec.app/screen-time-api-issues , https://riedel.wtf/state-of-the-screen-time-api-2024/

## 2.2 The three frameworks and what each does

| Framework | Role |
|---|---|
| **FamilyControls** | Asks the user for authorization (`AuthorizationCenter.shared.requestAuthorization(for: .individual)`), and presents `FamilyActivityPicker` so the user selects which apps/categories/domains to restrict. Returns opaque `ApplicationToken` / `WebDomainToken` values. |
| **ManagedSettings** | Applies the actual restriction. `ManagedSettingsStore().shield.applications = tokens` puts a system "shield" screen in front of the app. `store.webContent.blockedByFilter` / `WebContentSettings.FilterPolicy.specific(_:)` blocks web domains. |
| **DeviceActivity** | Schedules *when* restrictions turn on and off (`DeviceActivitySchedule`), and runs a `DeviceActivityMonitor` app extension that reacts to interval start/end and usage thresholds. |

  - Sources: https://developer.apple.com/videos/play/wwdc2021/10123/ , https://developer.apple.com/videos/play/wwdc2022/110336/ , https://developer.apple.com/documentation/managedsettings/webcontentsettings/filterpolicy , https://medium.com/@juliusbrussee/a-developers-guide-to-apple-s-screen-time-apis-familycontrols-managedsettings-deviceactivity-e660147367d7

**[V] Privacy wall:** the app receives **opaque tokens only**. You never learn *which* app the user picked — no bundle ID, no name. You cannot present "Instagram is blocked"; you can only render the token in Apple's `Label(token)` view. This constrains any MONARCH UI that wants to say "Gate sealed: Instagram."
  - Source: https://www.folio3.com/mobile/blog/screentime-api-ios/ and https://riedel.wtf/state-of-the-screen-time-api-2024/

## 2.3 THE ENTITLEMENT — the decisive question

**[V] There are two distinct entitlements.**

| | Entitlement | Approval needed? | What it unlocks |
|---|---|---|---|
| Development | `com.apple.developer.family-controls.development` | **No Apple approval.** Xcode adds it when you enable the Family Controls capability. | Build and run on your own device, real shields, real authorization flow. |
| Distribution | `com.apple.developer.family-controls` | **Yes — manual Apple review, per bundle ID.** | TestFlight and App Store. |

- **[V] Apple's own doc confirms the request is specifically for distribution:** *"Before distributing an app using Family Controls, the Apple Developer Account Holder must request permission…"* — and the entitlement Apple grants is the distribution one, not development. It also states that if the project already has Family Controls for development with automatic signing, **Xcode automatically updates the app to use the capability for distribution** once granted.
  - Source: https://developer.apple.com/documentation/familycontrols/requesting-the-family-controls-entitlement
- **[V] Request form:** https://developer.apple.com/contact/request/family-controls-distribution — must be submitted by the **Account Holder**. Also reachable from the "Capability Requests" tab in Certificates, Identifiers & Profiles. Approval shows as **"Assigned"** status against the bundle ID.
- **[V] You must file a SEPARATE request for every extension bundle ID** that links the frameworks: Device Activity Monitor, Device Activity Report, Shield Action, Shield Configuration. Forgetting an extension is a common cause of "approved but provisioning profile still missing the entitlement."
  - Sources: Apple doc above; https://newly.app/how-to/family-controls-entitlement ; https://developer.apple.com/forums/thread/795646 ; https://developer.apple.com/forums/thread/807188
- **[V/THIN] Approval bar:** Apple reviews manually. Reported criteria: the app's core purpose genuinely requires Screen Time functionality; it fits **family safety, parental control, or personal digital wellbeing**; and you are **not** harvesting usage data for advertising or profiling. Vague one-line justifications are reported to fail. **Turnaround reported at ~4 business days to a few weeks**; some developers report no response at all.
  - Source: https://newly.app/how-to/family-controls-entitlement (secondary — Apple does not publish the criteria, so treat the specific bar as [THIN])
  - Source: https://developer.apple.com/forums/thread/765098 ("no response to request for family controls entitlement")

**[V] CRITICAL — a free Apple ID (Personal Team) CANNOT use Family Controls at all.** Family Controls appears on Apple's supported-capabilities list as unavailable to Personal Team with no exception. On the simulator the app compiles and you can check types and layout, but **`AuthorizationCenter` authorization, `ManagedSettings` rule application, and the shield screen itself cannot be exercised** — and on a real device the app simply cannot be provisioned.
  - Source: https://hsb.horse/en/blog/personal-team-family-controls-limitation/
  - **This is the single most important finding in this document for scoping.** It means: **the blocker is not buildable without the $99/yr Apple Developer Program.** Everything else in MONARCH can ship on free provisioning; the blocker cannot.

### Answering the coordinator's questions directly
- **Does a third-party dev need a special entitlement?** For distribution, yes, approved per bundle ID. For running on their own phone, no approval — but they do need a paid account.
- **How is it requested?** The form above, as Account Holder, one submission per app + per Screen Time extension, with a written justification of why the app needs Screen Time access.
- **Can it work in a personal/sideloaded build without App Store review?** **Yes** — with the development entitlement, on a paid account, installed from Xcode. No App Store review, no distribution request. **[I]** This is the right path for MONARCH: a private app on the owner's own phone, so the distribution approval bar never applies.
- **Is a paid account required?** **Yes, unavoidably, for this feature specifically.**

## 2.4 The catch — known Screen Time API defects

Verified from a developer who ships one of the leading blockers (Frederik Riedel, one sec) — https://riedel.wtf/state-of-the-screen-time-api-2024/ :
- **6 MB memory limit on the `DeviceActivityMonitor` extension.** Frequently causes crashes under memory pressure. Keep the extension code near-empty.
- **`ApplicationToken` values change unpredictably (FB14082790).** New unknown tokens arrive in `ShieldConfigurationDataSource` / `ShieldActionDelegate` with no way to match them back to the `ManagedSettingsStore` that caused the block.
- **Token migration between stores (FB14237883)** leaves the shield UI showing stale/incorrect content.
- **`ShieldActionDelegate` supports only `.none`, `.close`, `.defer`.** You **cannot open your own app from the shield** (FB15079668). Workarounds use local notifications and are unreliable. This directly limits a "shield → open MONARCH → complete a quest to unlock" flow.
- **You cannot open the blocked target app from its token** (FB15500695).
- **Third-party blockers have no passcode protection** on their own permission (FB18794535) — the user can revoke authorization in Settings at any time, so self-binding is soft, not hard.
- **[V/THIN] Undocumented cap of ~49 blocked domains or ~49 apps** in a `ManagedSettingsStore` — cross it and blocking silently stops. Source: https://developer.apple.com/forums/thread/730444 , https://developer.apple.com/forums/thread/804684 (developer reports, not Apple documentation — treat as [THIN] but design under it).

**Build cost for a minimal MONARCH blocker [I]:** one Swift file for authorization + `FamilyActivityPicker`, one for `ManagedSettingsStore` shield toggling, and (only if you need scheduled auto-blocking rather than manual/session blocking) a `DeviceActivityMonitor` extension. Roughly 1–3 days of Swift for someone who has not touched these frameworks, plus the $99. A `ShieldConfiguration` extension to make the shield look like a MONARCH "GATE SEALED" screen is another half-day and is the highest-payoff cosmetic win in the whole project.

## 2.5 Non-iOS mechanisms (deprioritized, retained for completeness)
- **[V] Chrome extension `declarativeNetRequest`** blocks URLs at the desktop browser level. Only affects that browser profile on that machine; cannot touch native apps. Not the target platform.
- **[V] Android Digital Wellbeing / Focus Mode** is a first-party OS feature; third-party Android blockers typically use `AccessibilityService` or `UsageStatsManager` + an overlay. Not the target platform.

---

# PART 3 — CALENDARS AND ALARMS

## 3.1 Native: EventKit

**[V] A native app can write events and alarms directly to the device calendar with EventKit.** `EKEvent` + `EKAlarm` (relative offset or absolute date), saved via `EKEventStore.save(_:span:)`.
  - Sources: https://www.createwithswift.com/creating-and-saving-calendar-events/ , https://developer.apple.com/documentation/eventkit

**[V] Info.plist keys — changed in iOS 17.** Pick the narrowest:
- `NSCalendarsWriteOnlyAccessUsageDescription` — write-only access (iOS 17+). Enough if MONARCH only *adds* events.
- `NSCalendarsFullAccessUsageDescription` — full access (iOS 17+), required to read/edit/delete/fetch existing events. Requested with `requestFullAccessToEvents()`.
- `NSCalendarsUsageDescription` — the pre-iOS-17 key; still include it for backwards compatibility on older OS versions.
- iOS 17 also introduced the ability to add events **without prompting at all** via `EKEventEditViewController` (the user confirms in the system sheet), which sidesteps the permission dialog entirely.
  - Sources: https://developer.apple.com/forums/thread/742371 , https://github.com/gromb57/ios-wwdc23__AccessingCalendarUsingEventKitAndEventKitUI , https://dev.to/nemecek_f/ios-how-to-save-event-into-user-s-calendar-1e48

**[I] Recommendation:** in the native app, EventKit is a *nice-to-have*, not the reminder mechanism. `UNCalendarNotificationTrigger` is strictly better for reminders (no extra permission prompt, no calendar pollution, full control of copy). Use EventKit only if the owner genuinely wants MONARCH quests visible in Apple Calendar alongside real appointments.

## 3.2 Web: can a page write to a calendar without a backend/OAuth?

**[V] Google Calendar: no direct write without OAuth.** The Calendar API requires an OAuth2 access token, which requires a client-secret exchange, which requires a backend. The only no-auth path is the **template link**, which opens Google Calendar prefilled and requires the user to press Save:

```
https://calendar.google.com/calendar/render?action=TEMPLATE
  &text=URL-encoded+title
  &dates=20260901T003000Z/20260901T010000Z
  &details=URL-encoded+description
  &location=URL-encoded+location
```
- **[V] `dates` must be `YYYYMMDDTHHMMSSZ/YYYYMMDDTHHMMSSZ`.** There is **no timezone parameter and no reminder/alarm parameter** — you cannot set an alert through this URL. Manual user action required every time.
  - Sources: https://github.com/InteractionDesignFoundation/add-event-to-calendar-docs/blob/master/services/google.md , https://www.usecarly.com/blog/how-to-create-add-to-google-calendar-link/

**[V] `.ics` with a `VALARM` is the real no-backend path to a device-level alert.** The file is generated client-side (Blob → download / share), the user opens it, and the OS calendar imports it including the alarm.

### 3.2a Correct, copy-pasteable `.ics` — recurring daily event with a display alarm

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Monarch//Quest System 1.0//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VTIMEZONE
TZID:Asia/Kolkata
BEGIN:STANDARD
DTSTART:19700101T000000
TZOFFSETFROM:+0530
TZOFFSETTO:+0530
TZNAME:IST
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:monarch-daily-training@monarch.local
DTSTAMP:20260831T163000Z
DTSTART;TZID=Asia/Kolkata:20260901T060000
DTEND;TZID=Asia/Kolkata:20260901T063000
RRULE:FREQ=DAILY
SUMMARY:[DAILY QUEST] Training
DESCRIPTION:Complete the daily quest or accept the penalty.
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER:-PT10M
DESCRIPTION:[DAILY QUEST] Training in 10 minutes
END:VALARM
END:VEVENT
END:VCALENDAR
```

### 3.2b Correct, copy-pasteable `.ics` — one-off event

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Monarch//Quest System 1.0//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:monarch-gate-8f3a2c91@monarch.local
DTSTAMP:20260831T163000Z
DTSTART:20260905T133000Z
DTEND:20260905T140000Z
SUMMARY:[GATE] Boss Raid
DESCRIPTION:One-shot quest. Failure is recorded.
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER:-PT30M
DESCRIPTION:[GATE] Boss Raid in 30 minutes
END:VALARM
END:VEVENT
END:VCALENDAR
```

### 3.2c `.ics` gotchas — all [V] against RFC 5545 unless noted

- **Line endings MUST be CRLF (`\r\n`).** LF-only validates on lenient parsers and is rejected by strict ones. In JS: build an array of lines and `join('\r\n')` — do **not** use a template literal with real newlines.
- **Line folding:** lines SHOULD NOT exceed **75 octets** excluding the break. Fold by inserting `CRLF` + a **single space or HTAB**; the continuation line's leading space **counts against the next 75-octet budget**. Fold on **octet** boundaries but never inside a UTF-8 multi-byte sequence.
  - Sources: https://rfc-editor.org/rfc/rfc5545 §3.1 ; https://dev.to/sendotltd/building-an-rfc-5545-ical-file-generator-line-folding-escaping-and-all-5fid
- **Required VEVENT properties:** `UID`, `DTSTAMP`, `DTSTART`. `DTEND` (or `DURATION`) in practice. **`DTSTAMP` is the record's creation time in UTC, NOT the event start** — omitting it is a *silent* failure in some parsers.
- **`UID` must be globally unique and stable.** Re-importing the same UID **updates** the existing event rather than duplicating it — use this deliberately for "edit a quest's time"; get it wrong and you get duplicate events on every export.
- **`VALARM` with `ACTION:DISPLAY` REQUIRES exactly: `ACTION`, `DESCRIPTION`, `TRIGGER`.** `ACTION:AUDIO` requires only `ACTION` and `TRIGGER`. **`DURATION` and `REPEAT` must appear together or not at all** — "if one occurs, so MUST the other."
  - Source: https://icalendar.org/iCalendar-RFC-5545/3-6-6-alarm-component.html
- **`TRIGGER`** defaults to a duration relative to `DTSTART`. `-PT10M` = 10 min before; `PT0S` = at start; `TRIGGER;VALUE=DATE-TIME:20260905T130000Z` = absolute.
- **Text escaping:** in `SUMMARY`/`DESCRIPTION`, escape `\` → `\\`, `;` → `\;`, `,` → `\,`, newline → literal `\n`. An unescaped comma silently truncates or splits the value.
- **Timezones:** either emit UTC (`...Z` suffix, no `TZID`) which is unambiguous but wrong across DST for local wall-clock recurrences, **or** emit `DTSTART;TZID=Area/City:` **and include a matching `VTIMEZONE` block**. A `TZID` with no `VTIMEZONE` is a common source of Apple/Google disagreement. For a fixed-offset zone like `Asia/Kolkata` (+05:30, no DST) the `VTIMEZONE` is the trivial one shown above.
- **MIME type** must be `text/calendar` (`;charset=utf-8`). Serve with `Content-Disposition: attachment; filename="monarch.ics"` if server-hosted.

### 3.2d Does iOS actually honour an imported `VALARM`? — **[THIN]**
Apple Calendar generally imports and preserves `VALARM` reminders when the file is well-formed, and rejects files with malformed/missing required fields. However:
- I found **no authoritative Apple statement** guaranteeing that an imported `VALARM` becomes a device alert rather than being replaced by the user's default alert setting in Settings → Calendar → Default Alert Times.
- There is a documented history of Apple calendar clients mishandling `ACTION:EMAIL` alarms (https://fanf.livejournal.com/143907.html) — stick to `ACTION:DISPLAY`.
- Sources are secondary: https://www.cigatisolutions.com/blog/import-ics-to-apple-calendar/ . The existence of paid App Store utilities purely for importing `.ics` (ICSKit, Cal Import) suggests the flow has rough edges.
- **[I] Also unverified and likely to bite: `.ics` delivery on iOS Safari.** Blob-URL and `<a download>` downloads have historically been unreliable in iOS Safari, and are inert inside a standalone Home Screen PWA. Expect to need a share-sheet or a real hosted file URL.
- **Recommendation: prototype this on the actual iPhone before building anything on it.** Ten minutes of testing settles it.

---

# PART 4 — WRAPPER CHOICE

Constraint that decides everything: **FamilyControls, ManagedSettings, DeviceActivity and their app extensions are Swift-only. No wrapper abstracts them.** Every option requires writing Swift and adding Xcode app-extension targets. The real question is which wrapper makes adding a Swift bridge least painful while preserving the existing React + Vite codebase.

| Option | React code reuse | Swift bridge effort | Verdict |
|---|---|---|---|
| **Capacitor** | **~100%.** Components, state, CSS, Vite build pipeline all carry over unchanged. `npx cap add ios` wraps `dist/`. | Low. A local plugin is two Swift classes: an implementation `NSObject` and a `CAPPlugin`/`CAPBridgedPlugin` exposing `@objc` methods. Extensions are added as normal Xcode targets. | **Recommended.** |
| **React Native** | Low. RN uses its own primitives — no DOM, no CSS. Every component, all navigation, all styling would be rewritten. | Comparable to Capacitor (Turbo/native modules). | Rejected — the rewrite cost buys nothing MONARCH needs. |
| **Plain WKWebView wrapper** | 100%. | Highest. You hand-roll `WKScriptMessageHandler` + `evaluateJavaScript` message passing, plus your own local-notification and lifecycle plumbing that Capacitor already ships. | Only if you want zero dependencies and enjoy the plumbing. |
| **PWA only** | 100%. | N/A. | **Cannot do the two things that matter.** No app blocking, no offline scheduled local notifications. |

  - Sources: https://capacitorjs.com/docs/plugins/ios , https://capacitorjs.com/docs/ios/custom-code , https://www.joshmorony.com/creating-a-local-capacitor-plugin-to-access-native-functionality-ios-swift/ , https://staffordwilliams.com/blog/2023/03/06/ionic-capacitor-vite/ , https://capgo.app/blog/comparing-react-native-vs-capacitor/

**Capacitor freebies MONARCH gets immediately [V]:**
- `@capacitor/local-notifications` wraps `UNUserNotificationCenter`. The `Schedule` object exposes `at`, `repeats`, `every`, `count`, `on` (cron-like calendar matching, iOS + Android), `allowWhileIdle`. This means **daily quest reminders need zero Swift** — only the blocker does.
  - Source: https://capacitorjs.com/docs/apis/local-notifications
  - **Known bug [V]:** iOS scheduled notifications do not respect timezone changes — https://github.com/ionic-team/capacitor-plugins/issues/2361 . Plan a reschedule-on-timezone-change.
  - **[I]** The 64-pending-request iOS cap applies through the plugin too; it is an OS limit, not a plugin limit.
- `npx cap run ios --livereload` points the WebView at the Vite dev server, so iteration stays web-speed.

**[I] Recommended shape:** Capacitor shell → existing React app untouched → `@capacitor/local-notifications` for reminders → **one** hand-written local Capacitor plugin (`MonarchShield`) exposing `requestAuthorization()`, `pickApps()`, `shield(on:)`, `unshield()` to JS → optional `ShieldConfiguration` extension for the MONARCH-styled block screen.

---

# PART 5 — COST AND REQUIREMENTS TO RUN THIS ON A PERSONAL IPHONE

## 5.1 Free provisioning (Personal Team) — **[V]**
Signing in to Xcode with a plain Apple Account gives a "Personal Team". Limits:
- **Provisioning profiles expire 7 days from issuance.** The app stops launching and must be rebuilt and reinstalled weekly.
- **Max 3 registered test devices per platform.**
- **Max 10 App IDs registered at one time**, each expiring after 7 days.
- Signing identities last a year, but profiles are the binding constraint.
  - Sources: https://developer.apple.com/support/compare-memberships/ , https://learn.microsoft.com/en-us/xamarin/ios/get-started/installation/device-provisioning/free-provisioning , https://mybyways.com/blog/new-limitations-imposed-on-free-apple-developer-account/
- **[V] AND: Family Controls is unavailable to Personal Team with no exception** (§2.3). So free provisioning gets you MONARCH-with-notifications, but never MONARCH-with-blocking.

## 5.2 Apple Developer Program — $99/yr — **[V]**
- **Development provisioning profiles valid up to 1 year** (bounded by remaining membership). No weekly reinstall.
- Unlocks the Family Controls development entitlement → the blocker becomes buildable and runnable on the owner's own phone **without any App Store review or distribution request**.
- Also unlocks TestFlight (which *would* require the distribution entitlement request).
  - Source: https://developer.apple.com/help/account/provisioning-profiles/provisioning-profile-updates/

**[I] Recommendation: buy the $99. It is the cheapest line item in the project and it is a hard gate on the headline feature. It also removes the weekly reinstall ritual, which would otherwise mean a daily-use app that dies every Sunday.**

## 5.3 Is a Mac required? — **[V] For a good workflow, effectively yes; for producing builds, no.**
- Cloud macOS CI can build and sign an `.ipa` without owning a Mac: **Codemagic** (free tier ~500 macOS M1 minutes/month), **Bitrise**, **Ionic Appflow**, **Capawesome Cloud** (explicitly supports Capacitor/Ionic/Cordova/native iOS).
  - Sources: https://capawesome.io/blog/how-to-build-and-deploy-ios-apps-without-owning-a-mac/ , https://capgo.app/blog/automatic-capacitor-ios-build-codemagic/ , https://ionic.io/docs/appflow/package/intro
- **The catch [V]:** CI cannot replace a local Mac for interactive work. No Simulator, no debugger attach, no stepping through Swift. Given that the Screen Time API's documented failure modes are all runtime behaviours (opaque tokens changing, shield UI not updating, 6 MB extension OOMs), **debugging the blocker without a Mac would be brutal.** [I]
- **[I] Also:** installing a cloud-built `.ipa` onto a personal phone without TestFlight means ad-hoc distribution (device UDID registered, needs the paid account) or a sideloading tool. Xcode-from-a-Mac is by far the simplest route.

**[I] Bottom line on cost:** $99/yr, plus access to a Mac (borrowed, rented cloud Mac by the hour, or owned) for at least the Swift-plugin phase. The React side needs neither.

---

# PART 6 — COMPETITOR FEATURE MECHANICS

## 6.1 Life Reset (66 Day Habit) — **evidence quality varies, flagged per feature**

App Store: https://apps.apple.com/us/app/life-reset-66-day-habit/id6478942469 (bundle `build.designand.riselife`, publisher MWM). Marketing site: https://www.lifereset.com/ . Claims 1.5M+ users. **IAP prices observed: $12.99 / $17.99 / $28.99 / $34.99 / $39.99 / $49.99 / $59.99** (a price-tested spread, not tiers), 7-day trial on yearly.

**Core loop [V]:** goals are decomposed into **Daily Quests**. Completing a quest awards **XP**; XP drives a **level**; consecutive completion drives a **streak**. Framed around the 66-day habit-formation number. Home-screen **widgets** surface today's quests and streak without opening the app.

**Hard Mode [V, mechanics INFERRED]:**
- Verified marketing text: *"holds you to a higher standard with real accountability and penalties for missed days."* That is the entirety of what is publicly documented.
- **[I]** The only mechanically coherent readings are (a) a missed day zeroes or heavily decays the streak with no grace/freeze, and/or (b) a missed day subtracts XP or de-levels. What appears on screen is almost certainly a streak counter reset to 0 and/or a negative XP event.
- **[THIN]** I could not verify whether Hard Mode is opt-in per goal or global, whether it revokes streak-freezes, or whether it can wipe progress entirely. **Do not copy this feature from assumption — the interesting design question (is the penalty reversible?) is exactly the part that is undocumented.**

**Season Challenge [V-lite]:**
- Verified: the app runs numbered **Seasons** (release notes reference *"Season 5"*) and users *"climb the ranks"* on a leaderboard.
- **[I]** Standard mechanics for this pattern: a fixed-length competitive window, a rank ladder driven by season-only XP, a leaderboard against other users, and a **rank reset/soft-reset at season rollover** so returning users have something to re-earn. Season rewards/cosmetics are the usual retention hook.
- **[THIN]** I found no source describing the season length, the rank tiers, the reset rule, or the rewards. This is genuinely undocumented outside the app.

**Journey [THIN]:**
- Nearest verified description ties it to reflective content: emotion tracking, daily journaling, attaching media *"to make your journey personal and memorable"*, and a milestone celebration at day 66.
- **[I]** Reads as a chronological timeline/scrapbook of the 66 days — entries, mood, photos, milestone markers — i.e. a **retrospective record**, not a scoring mechanic. No win condition, no failure state. Its incentive function is sunk cost: the longer the timeline, the more expensive quitting feels.
- **[THIN]** I could not confirm it is even called "Journey" in-product versus being marketing framing.

**Smart Schedule [NOT VERIFIED AT ALL]:**
- **I found zero sources describing a "Smart Schedule" feature in Life Reset.** It appears in neither the App Store description, the Google Play description, the marketing site, nor any review. It may be paywall-screen-only copy, a very recent addition, or misattributed.
- **[I]** By strong convention across the category, "smart schedule" means **auto time-blocking**: the app places habits into free slots on a 24-hour timeline, avoiding conflicts, and reflows them as the day changes. Mechanically it writes a start time to each task, optionally syncs to the device calendar, and re-plans on completion or miss. Verified examples of this pattern: **Reclaim.ai Habits** (auto-blocks routines into Google/Outlook Calendar and reschedules as meetings move — https://reclaim.ai/features/habits) and **Afternoon** (auto-scheduler finds free slots, single 24-hour timeline — https://apps.apple.com/app/id6743663885).
- **Treat any spec derived from this as a design decision, not competitive intelligence.**

**Tools bundle [V]:** AI Calorie Tracker, Focus Timer / Pomodoro, Book Summary, Meditation (AI-voice guided sessions), **Screen Blocker**, Workout Counter, Deep Breathe, Journal. Marketed as "7 built-in tools."
- **[I] The strategically important one is Screen Blocker.** Its presence means Life Reset holds (or operates under) the Family Controls distribution entitlement — direct evidence that a habit app with a blocker does get approved. It also means the tool bundle is a **breadth-over-depth** play: eight shallow utilities as subscription justification. MONARCH, as a single-user app, gains nothing by copying breadth; one deep, well-integrated blocker beats eight stubs.
- **[V] User sentiment signal:** reviews cite aggressive paywalling after a long onboarding and very little free functionality. Worth knowing that the category leader is disliked for exactly the monetisation MONARCH does not need.

## 6.2 Habitica — the most mechanically documented comparator **[V]**

The reference implementation for "RPG mechanics applied to real tasks", and the only one with a public rules wiki.

- **HP as the failure currency.** Missed Dailies, negative Habits, and Quest Boss attacks all remove HP. Reaching 0 HP = **death**.
- **Death penalty is concrete and graded, not cosmetic:** lose a level, lose all Gold, and lose one equipped item. This is the design lesson — the penalty is *painful but bounded and recoverable*, which is why users tolerate it.
  - https://habitica.fandom.com/wiki/Death_Mechanics
- **Cron.** Damage is not applied in real time. A nightly **Cron** processes the previous day when the user next logs in — missed Dailies are tallied and HP deducted then. **[I] This is directly transferable to MONARCH: it removes any need for background execution. Compute the penalty lazily at launch from stored timestamps.**
- **Task value colouring.** Every task carries a hidden value that drifts down when neglected and up when completed, rendered as a red→blue colour. **Redder (more neglected) tasks deal MORE damage when missed and give more XP when finally done.** This is a self-balancing anti-avoidance mechanic and the single cleverest idea in the app.
  - https://habitica.fandom.com/wiki/Damage_to_Player
- **Boss quests as a damage multiplier.** During a boss fight, missed-Daily damage is multiplied, and a player takes damage for **other party members'** missed Dailies. Completing Dailies/Habits/To-Dos damages the boss. Social accountability implemented as shared HP.
  - https://habitica.fandom.com/wiki/Boss
- **[V] Known failure mode, straight from the issue tracker:** *"Missed dailies do massive amounts of damage"* — https://github.com/HabitRPG/habitica/issues/3161 . Users with many Dailies get one-shot after a single bad day and quit. **Tuning lesson for MONARCH: penalty must scale sub-linearly with the number of tracked quests, or a busy week becomes unrecoverable and the app gets deleted.**

## 6.3 Finch — the deliberate opposite **[V]**
- Virtual bird pet. Completing goals/journal entries/check-ins yields **Energy**, which sends the bird on Adventures; **Rainbow Stones** are the shop currency.
- **No penalties, no streak loss, no leaderboards, no competitive pressure.** Explicitly designed so missing a day costs nothing.
  - https://finch.fandom.com/wiki/Finch_App , https://apps.apple.com/us/app/finch-self-care-pet/id1528595748
- **[I] Relevance to MONARCH:** Finch and Habitica bracket the design space. Solo Leveling's fantasy is *punishment as a growth mechanic*, so MONARCH belongs at the Habitica end — but Habitica's own bug tracker proves the failure mode of over-tuning it. Consider Finch's insight in one narrow place: a **grace/streak-freeze token** the owner earns, so the punishment is real but the system is not brittle.

## 6.4 Forest — one mechanic, done completely **[V]**
- Start a focus timer, a tree grows; leave the app before the timer ends, the tree **dies** and stays dead in your forest as a permanent visible record.
  - https://alternativeto.net/software/forest-app/
- **[I] The mechanic that matters is the persistent visible scar** — the failure is not a number that decrements, it is an artifact that stays in the UI forever. Cheap to implement, disproportionately effective, and stylistically perfect for a Solo-Leveling "record of failures" panel.

## 6.5 Solo-Leveling-themed apps already shipping on the App Store **[V]**
This niche is **already crowded**, which is both validation and warning:
- **Solo Level : System** — https://apps.apple.com/ca/app/solo-level-system/id6755756882 — daily quests → XP → stats, **E-Rank to S-Rank** progression, quest log, AI personalisation. iOS 16.0+.
- **Solo X Player Leveling Workout** — https://apps.apple.com/us/app/solo-x-player-leveling-workout/id6748594462 — "the System", daily quests, XP, E→S rank, **global leaderboard**. iOS 16.6+. Site: https://soloxplayer.com/
- **Solo Leveller** — https://apps.apple.com/us/app/solo-leveller/id6745834094
- **Solo Leveling Your Self** — https://apps.apple.com/us/app/solo-leveling-your-self/id6770878729
- **ARISE SOLO** — https://arisesolo.com/ ("Sung Jin Woo workout app")
- **HabitForge** — https://habitforge.io/solo-leveling-app/
- **[I] Two observations.** (1) The convergent design is invariant: *daily quests → XP → stats → E-through-S rank*. MONARCH should assume the owner already expects that shape. (2) Several of these use "Solo Leveling" and even the protagonist's name **in the App Store listing** — see Part 8 for why that is a live risk rather than a precedent to follow.

---

# PART 7 — VISUAL REFERENCE: "PROJECTED LIGHT" VS "FLAT DASHBOARD"

The distinction the brief asks about is real and reducible to techniques. A flat dashboard says *this is a surface with ink on it*. A HUD says *this is light emitted into darkness by a machine.* Concrete levers, ordered by impact:

**1. Light is emitted, never applied.** Every accent colour must appear to have a **halo** — the same hue at low alpha, blurred, bleeding past the element edge. `box-shadow: 0 0 12px rgba(accent, .45)` and `text-shadow: 0 0 10px <accent>` are the whole trick. A border with no glow reads as ink; a border with a matched glow reads as a lit filament. **[V]** https://designmd.app/library/cyberpunk-ui

**2. Restrict the emitting area to 10–15% of the screen.** *"The glow becomes ineffective if everything glows."* Most of the screen must be near-black so the lit parts have something to be lit against. **[V]** (source above)

**3. Near-black, never pure black; never pure white.** `#0D0D0D`-class backgrounds. Documented do-nots include pure white surfaces and saturation above ~80%. **[V]** (source above)

**4. Semantic, not decorative, colour.** In authentic HUD systems each hue carries meaning — cyan = data/system, amber = caution, red = failure, green = confirmed. Phosphor green and electric cyan are the canonical HUD hues; amber/orange reads as vintage radar. **[V]** https://designmd.app/library/cyberpunk-ui , https://fontvibe.ai/styles/cyberpunk-tech-hud
   - **[I]** For MONARCH specifically: Solo Leveling's System windows are near-monochrome cyan/blue on black with white text, reserving other hues for warnings and penalties. That single-hue discipline is what makes them read as one machine speaking.

**5. Frame with corner brackets, not closed borders.** Angular brackets, hexagons and scan frames that mark corners and leave edges open. **An incomplete frame implies an active scan; a closed rounded rectangle implies a printed card.** This is the highest-leverage single change to make a React card component stop looking like Bootstrap. **[V]** https://fontvibe.ai/styles/cyberpunk-tech-hud
   - **[I]** Implementable with two absolutely-positioned pseudo-elements per corner using `border-top`/`border-left` on a small square, or a single SVG frame — no library needed.

**6. Corner radius near zero, borders thin (1–1.5px).** Documented values in the reference system sit at `8px` max radius and `1px`–`1.5px` strokes. **[V]** (designmd) **[I]** For a stricter HUD read, go to `0`–`2px`: rounding is a physical-object cue, and projected light has no manufactured corner.

**7. Monospace for all data, geometric sans for headings.** Terminal typefaces for readouts, numbers, labels and system messages; a geometric sans for titles. The contrast between *machine type* and *human type* is what makes a number feel like telemetry. Small caps and wide letter-spacing on labels (`0.75rem`, weight 500) reinforce it. **[V]** https://designmd.app/library/cyberpunk-ui , https://fontvibe.ai/styles/cyberpunk-tech-hud
   - **[I]** Tabular figures matter more than the typeface choice: numbers that jitter in width as they tick destroy the readout illusion instantly. `font-variant-numeric: tabular-nums`.

**8. Scanlines as a whole-screen overlay, capped at ~0.1 opacity.** A `::before` with `repeating-linear-gradient`. Ties every element to the same imaginary emitter. **[V]** (designmd)

**9. One glitch effect per view, maximum.** Chromatic aberration, noise and glitch transforms are seasoning. *"Two and you're a MySpace page."* **[V]** (designmd)

**10. Data density is a feature.** Real HUDs are crowded with secondary readouts, coordinates, tick marks and annotations that nobody reads. Sparse whitespace reads as a marketing site. **[V]** https://fontvibe.ai/styles/cyberpunk-tech-hud , https://scifiinterfaces.com/tag/hud/

**11. Animate arrival, not idle state.** Motion should be *entry* — a scan sweep, a type-on, a bracket snapping into place — with spring physics (referenced values: stiffness 120, damping 20) over ~200ms. **[V]** (designmd) **[I]** Constant ambient animation reads as a screensaver; a panel that *arrives* reads as a system responding.

**12. No emoji in the UI.** Explicit do-not in the reference system, and directly relevant — emoji are the fastest way to break a machine-voice interface. **[V]** (designmd)

**Further reference:** https://scifiinterfaces.com/tag/hud/ (critical analysis of screen HUDs), https://freefrontend.com/css-sci-fi-style/ (working CSS implementations to lift from).

---

# PART 8 — LICENSING AND TRADEMARK

**Not legal advice.** This is a summary of sources with reasoning shown, so the reasoning can be checked rather than trusted.

## 8.1 Copyright in short quoted lines

**The framework [V]:** US fair use is a four-factor balancing test — (1) purpose and character of the use, including commercial vs non-commercial and whether it is transformative; (2) nature of the copyrighted work; (3) amount and substantiality used relative to the whole; (4) **effect on the market for the original**. It is fact-specific and, in the sources' own words, hard to predict.
  - https://www.nolo.com/legal-encyclopedia/fair-use-rule-copyright-material-30100 , https://authorsguild.org/resource/fair-use-for-authors/ , https://en.wikipedia.org/wiki/Fair_use

**Reasoning, not assertion:**

**(a) Personal, non-distributed app.** Copyright's exclusive rights are reproduction, distribution, public performance, public display, and derivative works. **[I] If the app never leaves the owner's own device, there is no distribution, no public display, and no audience — so there is no plaintiff, no discoverable act, and functionally no market effect.** Note carefully: this is *practical* safety through the absence of an infringing public act, **not** a fair-use finding. Copying text into a private file is technically a reproduction. The honest formulation is: *the legal question is unlikely ever to be reached.* **[I]**

**(b) What changes on public deployment.** Everything relevant changes at once:
- Distribution and public display now genuinely occur.
- Factor 1 shifts against you if the app is monetised in any way.
- Factor 4 becomes arguable — Solo Leveling has an active licensed-merchandise and licensed-game business, so an app trading on its text competes with a market the owner actually exploits. **[I]**
- Factor 3: short, non-central lines used as flavour weigh in favour; the more the quotes *are the product* (i.e. users come for the Solo Leveling text), the worse it gets. **[V]** on the general principle — a short quote from a much larger work is often fair use, *especially* when used to explain, teach, or comment on it. MONARCH would be using it as **decoration**, not commentary, which is the weaker position. https://janefriedman.com/the-fair-use-doctrine/
- Practical exposure at public scale is a DMCA takedown or an App Store removal long before it is a lawsuit. **[I]**

**[I] Actionable read:** ship whatever you like privately. **Before any public deployment, rewrite the flavour text in the same register rather than quoting.** The System's *voice* — terse, imperative, bracketed, impersonal — is a style, and **style is not copyrightable**. `[DAILY QUEST HAS ARRIVED]` written by you carries the entire feeling with none of the exposure. This is the cheapest risk elimination available and costs an afternoon.

## 8.2 Anime art and fan art

**[V] Fan art is a derivative work.** The right to prepare derivative works is exclusive to the copyright holder. Fan art is infringing by default, **regardless of whether you profit**, and transformativeness/fair use are defences that must be argued, not automatic protections.
  - https://www.animenewsnetwork.com/feature/the-law-of-anime/2013-02-15/2 , https://ir.lawnet.fordham.edu/iplj/vol31/iss2/4/ , https://www.ac-legal.com/fandom-and-fair-use/

**[V] Enforcement reality:** most rightsholders do not pursue fan artists, and many treat it as free marketing — *unless* the work competes with their own products or is commercialised at scale.

**[I] But an app is not a Tumblr post.** Two things make shipping anime art or fan art in a distributed app materially worse than posting it: (1) it is a product, in a store, with a listing — high visibility and a clear commercial context; (2) **the App Store enforces this independently of any court.**
- **[V] App Store Review Guideline 5.2 (Intellectual Property):** apps must be submitted by a party that owns or has licensed all relevant IP; you must not use protected third-party material without permission, and if the app features third-party trademarks or copyrighted content **you must supply the authorization.**
- **[V] Guideline 4.1 (Copycats):** you may not use another party's icon, brand, or product name in your app's icon or name without approval. Apple tightened this in late 2025.
  - https://developer.apple.com/app-store/review/guidelines/ , https://9to5mac.com/2025/11/13/apple-tightens-app-review-guidelines-to-crack-down-on-copycat-apps/
- **[I] Consequence:** anime screenshots, character art, or recognisable fan art in a **public** MONARCH would likely be rejected at review or pulled later, entirely separate from any copyright claim. In a **private** build installed via Xcode, App Review never happens and this is moot.

**[I] Practical position:** private build — use anything. Public build — commission or generate original art, or go art-free. **The pure-HUD direction in Part 7 is genuinely the strongest aesthetic option and is 100% ownable**: glow, brackets, monospace and scanlines are unprotectable design techniques. The Solo Leveling *feeling* lives in the interface language, not in the characters.

## 8.3 "Solo Leveling" as an app name — **a real trademark problem [V]**

- **SOLO LEVELING is a registered trademark of D&C WEBTOON Biz Co., Ltd.** US serial **79316775**, filed **17 May 2021** via international registration **1604933**, auto-protection date **29 January 2023**.
- **The goods explicitly include, in Class 9: *"software; application software for smartphone"*** — alongside downloadable electronic publications, downloadable webtoons, downloadable video game programs, and more.
  - https://trademarks.justia.com/793/16/solo-79316775.html

**[I] Why this is worse than the copyright question.** Trademark infringement turns on **likelihood of confusion within the relevant goods class**, not on copying. The mark is registered *for smartphone application software* — precisely what MONARCH would be. An app named "Solo Leveling <anything>" in the App Store sits squarely inside the registered class. Unlike copyright fair use there is no "it's only a little bit" defence, and trademark owners must police their marks or risk weakening them, so enforcement is structurally more likely than with fan art.

**[V] Note the crowd of existing App Store apps using the name** (§6.5: "Solo Leveling Your Self", "Solo Levelling", ARISE SOLO invoking "Sung Jin Woo"). **[I] Read this as unenforced-so-far, not as permission.** Those listings are exposed to both App Store Guideline 4.1/5.2 removal and a direct trademark claim; their continued existence is evidence of D&C's current enforcement appetite, which can change with one email.

**[I] Recommendation:**
- Private build: name it anything.
- Public build: **"MONARCH" is already the correct answer** — evocative of the Shadow Monarch to anyone who knows, meaningless to a trademark examiner, and unencumbered. Do not put "Solo Leveling" in the app name, subtitle, keywords, icon, or screenshots. Describing the app as "inspired by" a work in body copy is nominative use and far safer than putting the mark in the name — but even that is best avoided in App Store metadata given Guideline 4.1.
- **[I]** Run a clearance search on "MONARCH" in Class 9 before any public launch; it is a common word and may itself be registered by someone.

---

# APPENDIX — DECISION SUMMARY

| Question | Answer | Confidence |
|---|---|---|
| Scheduled local notification from a closed PWA on iOS | **Impossible.** Web Push only, needs a server. | [V] high |
| Notification Triggers API | **Abandoned by Google**, never shipped, never in Safari. | [V] high |
| Periodic Background Sync | Chromium-only, **no Safari/iOS**, timing not developer-controlled. | [V] high |
| Scheduled repeating local notification, native iOS | **Yes.** `UNCalendarNotificationTrigger`, `repeats: true`, no server. **64 pending-request cap.** | [V] high |
| Web app blocking another app | **Impossible on every platform.** | [V] high |
| Native iOS app blocking Instagram | **Yes** — FamilyControls + ManagedSettings + DeviceActivity. | [V] high |
| Blocker on a free Apple ID | **No.** Family Controls unavailable to Personal Team. | [V] high |
| Blocker on own phone without App Store review | **Yes**, with the paid account + development entitlement. No distribution request needed. | [V] high |
| Cost floor | **$99/yr** + Mac access for the Swift phase. | [V] high |
| Best wrapper | **Capacitor** — ~100% React reuse, easiest Swift bridge, free local-notifications plugin. | [V] med-high |
| `.ics` + `VALARM` as a stopgap alarm | Syntax settled and given above; **whether iOS honours the alarm on import is unverified — test on the phone.** | [THIN] |
| Life Reset Hard Mode / Season / Journey mechanics | Named and confirmed to exist; **internal mechanics undocumented publicly.** | [THIN] |
| Life Reset "Smart Schedule" | **Zero sources found.** Category convention is auto time-blocking. | not verified |
| Short Solo Leveling quotes, private app | No public act occurs; question never reached. Rewrite before any public release. | [I] |
| "Solo Leveling" as an app name | **Registered trademark covering smartphone application software.** Avoid in name/metadata. | [V] high |

## Highest-value next actions
1. **Buy the Apple Developer Program ($99)** — a hard gate on the blocker, and it removes the 7-day reinstall treadmill.
2. **Add Capacitor to the existing Vite build** and wire `@capacitor/local-notifications`. This alone delivers real daily quest reminders with zero Swift and zero backend.
3. **Spike the `ShieldConfiguration` extension early**, not late — the MONARCH-styled "GATE SEALED" screen in front of Instagram is the emotional core of the product and the riskiest unknown.
4. **Do not build the Web Push backend** for the PWA stopgap. It is a server, it is throwaway, and it contradicts local-first. If the stopgap needs reminders before the native app exists, test the `.ics` path (§3.2) on the actual phone first — thirty minutes of testing decides it.
5. **Rewrite the System's flavour text in your own words now**, while the corpus is small. It removes the only real copyright exposure at essentially zero cost.

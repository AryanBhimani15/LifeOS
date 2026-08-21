# Mobile clients

LifeOS currently has two deliberately separate iPhone experiments:

- [`ios/`](../ios/) is the active, lightweight **native SwiftUI companion**.
  It has Today, Tasks, Calendar, sign-in, connected task/event detail and
  authenticated attachment downloads.
- [`mobile/`](../mobile/) is the older Expo voice-first capture prototype. It
  remains intact for reference; it is not the app to open for the current iOS
  companion.

The native app is intentionally not a narrow WebView or a phone-sized copy of
every desktop page. It uses the same LifeOS API and canonical repositories,
while staying focused on the small moments that work best on a phone.

## Native SwiftUI companion

```
login → Today → quick task capture / complete → task or event detail
                     ↘ Tasks list / Calendar agenda
```

It contains no server credentials, Azure keys, duplicate NLP/date rules or
mobile-only data tables. The deterministic parser, task writer, calendar
projection and reminder writer stay on the LifeOS backend.

### Native API contract

Every endpoint below accepts `Authorization: Bearer <accessToken>` after sign-in.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/mobile/today` | timezone-aware Today projection and canonical schedule load |
| `GET` | `/api/mobile/tasks?filter=` | server-backed Open / Today / Upcoming / Completed list |
| `POST` | `/api/mobile/tasks/preview` | deterministic capture-parser preview |
| `POST` | `/api/mobile/tasks` | canonical task capture with optional date, importance, note and reminder |
| `PUT` | `/api/mobile/tasks/:id/reminder` | set or clear the canonical task reminder |
| `GET` | `/api/mobile/calendar?date=` | canonical month-grid calendar projection |
| `GET` | `/api/tasks/:id/detail` | task detail, event link, reminder and documents |
| `PATCH` | `/api/tasks/:id` | task title, note, date/time, importance and completion |
| `GET` | `/api/events/:id` | event/exam detail, preparation tasks, notes and resources |
| `GET` | `/api/attachments/:id/download` | authenticated private attachment download |

For setup and the exact native scope, see [`ios/README.md`](../ios/README.md).

---

## Legacy Expo capture prototype

A voice-first capture app for iPhone. It is **not** a small copy of the web app.

```
launch → tap the mic → speak → see the plan → confirm
```

That is the entire product. There is no task list, no calendar, no dashboard —
the web app already does those better on a bigger screen, and a miniature copy
would be worse at both.

## Where the legacy prototype lives

```
~/LifeOS/
├── src/            the Next.js web app and the API (unchanged)
├── prisma/         one schema, one database
├── mobile/         the Expo app
├── ios/            the active native SwiftUI companion
└── docs/
```

The web app was **not** moved into a `web/` folder. The brief showed that layout
but also said not to reorganise unnecessarily, and relocating a working Next.js
app breaks every relative path, the Prisma config, the migration history and the
test setup for no functional gain. Adding `mobile/` alongside achieves the same
separation at zero risk. Say the word if you want the move anyway.

## The rule that shapes everything

**No business logic in the mobile app.** The client attaches credentials, sends
text, renders what comes back. Every decision — what a command means, which rows
it touches, whether it is destructive, whether confirmation is required — is
made server-side. The mobile app cannot bypass a rule because it does not
contain one.

That is also what keeps a future native Swift client cheap: it needs to speak
HTTP and JSON, nothing more.

## The flow

1. **Speech is transcribed on the device.** Only text leaves the phone. Streaming
   audio to the server would spend the AI quota on transcription instead of
   understanding, add bandwidth, and put a recording of a personal task list on
   the wire.
2. **Only the final transcript is sent.** Firing a request per interim result
   would exhaust a 20-requests-per-minute quota inside one sentence.
3. `POST /api/ai/command` returns a **plan**. Nothing has mutated yet.
4. The plan renders as a **receipt** — each resolved action, deletions marked.
5. `POST /api/ai/plans/:id/execute` runs it, with `confirmed: true` required for
   anything destructive. **The server enforces that**, so the dialog is a
   courtesy rather than the control.
6. The web app reads the same database, so it is already in step. There is no
   sync protocol because there is nothing to sync.

## API contract

Every endpoint accepts `Authorization: Bearer <accessToken>`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/mobile/auth/login` | email + password → token pair |
| `POST` | `/api/mobile/auth/refresh` | refresh token → new access token |
| `POST` | `/api/mobile/auth/revoke` | sign out this device only |
| `GET` | `/api/mobile/me` | identity, timezone, two counts |
| `POST` | `/api/mobile/devices` | register/refresh a push target |
| `POST` | `/api/ai/command` | text → plan (never mutates) |
| `POST` | `/api/ai/plans/:id/execute` | run a plan |
| `POST` | `/api/ai/plans/:id/reject` | discard a plan |

Everything else the web app exposes (`/api/tasks`, …) works with a bearer token
too — `defineRoute` resolves either credential into a userId, so there is one
authorization path, not two.

### Authentication

- **Access token**: JWT, 15 minutes, audience `lifeos-mobile`. The web session
  JWT is signed with the same secret, so the audience is checked — otherwise a
  web token would be replayable as a mobile one. There is a test for that.
- **Refresh token**: opaque random, 60 days, stored in the iOS Keychain with
  `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`. The server stores only a SHA-256 hash,
  so a database leak yields nothing usable.
- **No rotation.** Deliberate. On a flaky connection the server would rotate,
  the response would drop, and the client would hold an invalidated token — a
  permanent logout with no recovery path. Revocation is per-device and immediate,
  which covers the realistic threat for a personal app.
- **Sign-out revokes one device.** Signing out on the phone leaves the browser
  session alone.

### Idempotency

`execute` accepts an `idempotencyKey`. Duplicate *mutation* was already
impossible — the plan is claimed with a conditional UPDATE, so a retry finds it
non-PENDING. The problem this solves is different: without a key, a retry after a
dropped response reports an **error for work that succeeded**. With one, the
stored result is replayed. Mobile networks drop responses often enough that this
matters.

### Plan expiry

Plans expire after 10 minutes. If a user speaks on the street, walks into a lift,
and confirms once signal returns, the plan may be gone.

The client re-plans from the stored transcript rather than asking the server to
run a stale plan. Executing an expired plan would defeat why expiry exists: the
ids it resolved may no longer be the rows the user was shown.

## Running it

The mobile app needs the web app running, because the web app **is** the backend.

```bash
# terminal 1 — the backend
cd ~/LifeOS
npm run dev
npm run db:seed          # demo@lifeos.local / lifeos-demo-2026

# terminal 2 — the app
cd ~/LifeOS/mobile
npm start
```

### Pointing at the right host

`localhost` inside the iOS simulator means *the simulator*, not your Mac. On a
physical device it means the phone. Set the LAN address:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.130:3000 npm start
```

The login screen prints the address it will use, so a wrong value is visible
rather than presenting as a hang.

### Speech needs a development build

`expo-speech-recognition` includes native code, so Expo Go cannot run it:

```bash
npx expo run:ios          # requires Xcode
```

Typing works in Expo Go, and the **Type instead** button is always available —
on-device dictation is unavailable offline without downloaded assets, and a
capture app that cannot capture is useless.

## Testing

```bash
cd mobile
npm run typecheck
npm test                  # integration tests against a running server
npx expo export --platform ios   # proves the app bundles
```

`npm test` runs the client's real code against a real server; only the Keychain
is stubbed. A mocked server would only prove the mock matches my assumptions,
which is the bug class these are meant to catch.

Each run provisions a throwaway account, because sign-in is throttled to 8
attempts per 15 minutes per address and a suite pinned to one account fails on
its second run of the day for reasons unrelated to the code.

## Known limitations

1. **Push notifications are registered but not delivered.** `/api/mobile/devices`
   stores tokens and returns `pushDeliveryEnabled: false`. Actually sending
   requires an Apple Developer account and an APNs key, which this project does
   not have. Reminders exist in the schema; nothing dispatches them yet.
2. **Not run on a physical device.** It typechecks, lints, bundles for iOS, and
   its API client passes integration tests against the live server — but no one
   has held it in their hand. Speech recognition in particular can only be
   properly judged on real hardware.
3. **No offline queue.** A command spoken with no signal fails rather than being
   stored and replayed. The transcript is kept for a retry, but only in memory.
4. **Speech is English-only** (`lang: "en-US"`).
5. **No biometric lock.** Anyone holding an unlocked phone can use the app.

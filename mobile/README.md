# LifeOS mobile

Voice-first capture companion for the LifeOS web app.

**Read [../docs/mobile.md](../docs/mobile.md) first** — it covers the API
contract, the token model, and what does not work yet.

## Quick start

```bash
# the backend must be running: cd .. && npm run dev
npm install
npm start
```

Simulator or device not on the same host as the server:

```bash
EXPO_PUBLIC_API_URL=http://<your-lan-ip>:3000 npm start
```

`localhost` inside the simulator refers to the simulator, which is the usual
reason a first run looks like it is hanging. The login screen prints the address
it is using.

## Speech

Needs a development build, because `expo-speech-recognition` ships native code:

```bash
npx expo run:ios     # requires Xcode
```

In Expo Go the microphone will not start — use **Type instead**, which is always
available regardless.

## Checks

```bash
npm run typecheck
npm test                          # integration tests, needs the server running
npx expo export --platform ios    # proves it bundles
```

## Layout

```
app/          screens (expo-router): capture + login
components/   MicButton, PlanReceipt
lib/          api client, keychain storage, speech, theme, types
tests/        integration tests against a real server
```

`lib/api.ts` is the only file that talks to LifeOS. Nothing here decides what a
command means — the server does, and that is the point.

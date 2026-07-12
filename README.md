# NoofGains

One-tap training consistency. Built for exactly one user.

A dependency-free PWA: log workouts with a single tap on a loose Push → Pull → Legs
rotation, track body weight against a 7-day average with bulk/cut modes, answer two
binary check-ins (sleep, food), follow a weekday-aware meal plan with computed macro
targets, and get called out by local insights — or by Claude, if an API key is set.

- **Stack**: vanilla HTML/CSS/JS, no build step, localStorage, hand-rolled SVG charts
- **PWA**: cache-first service worker, installable from Safari via Add to Home Screen
- **AI coach**: optional, direct browser call to the Claude API with your own key

## Develop

Serve the folder with any static server, e.g. `npx http-server -p 8123 -c-1 .`
(the service worker skips caching on localhost).

## Deploy

Push to `main` — GitHub Pages serves the repo root.

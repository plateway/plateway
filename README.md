# Plateway

A free, phone-first planner for UK trade-plate (vehicle delivery) drivers. Try it at https://plateway.pages.dev and add it to your home screen.

Plateway is an independent project. It is not connected to or approved by any vehicle logistics or auction company.

It plans a day of vehicle delivery jobs for two kinds of user:

The app opens on a short splash, then asks who is planning. The answer is remembered, with a Switch button in the header.

- **A plate driver** enters where they start and their jobs, then sees the day on a map and a timeline. Solo mode fills the gaps between jobs with bus, train and walking. Lift mode fills them with a lift car.
- **A lift driver** enters each driver (by call sign) and their jobs, and gets the order of drops and pick-ups that finishes soonest, with a line per driver showing who is waiting where.

A plate driver also gets **History and pay**: every job is kept by day, marked done or failed, and priced from editable rates (by default £20 a move, 20p a mile over 60, £8 for an inspection). In Solo mode the plan shows likely bus and train fares.

Jobs can be typed in by postcode, pasted from the job email, or read from screenshots of it. Screenshots are read on the device and are not uploaded.

## Run it

```
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests for the planning engine and the job-sheet reader
npm run e2e        # real browser journeys against a production build, phone and desktop width
npm run build      # production build in dist/
npm run deploy     # build, then upload dist/ to Cloudflare (run `npx wrangler login` once first)
```

Live at https://plateway.pages.dev (Cloudflare Pages project `plateway`). Hosting is set in `wrangler.jsonc`; `public/_headers` keeps the page and service worker from being cached so updates reach phones.

`npm run e2e` uses the live services below, so it needs a connection. To include the screenshot-reading journey, set `SHOTS_DIR` to a private folder holding `1.png`, `2.png`, `3.png` (job email screenshots) and an `expected.json` with what they say (`{"rows": [[jobNumber, collect, deliver], ...], "liftFrom": "...", "datePassed": true}`). Without it that journey is skipped. Never commit real job screenshots: they hold personal details.

## Services it relies on

All free, no keys. All are community services with fair-use limits and no uptime promise.

| For | Service |
| --- | --- |
| Postcode to location | postcodes.io |
| Road routes and drive times | OSRM (project-osrm.org, with openstreetmap.de as backup) |
| Bus and train | Transitous |
| Map | OpenFreeMap, drawn with MapLibre |
| Reading screenshots | Tesseract.js, on the device |

## Where things are

- `src/lib/` is the engine, with no screen code: `planDriver.ts` (one driver's day), `planLift.ts` (the lift run), `parseJobs.ts` (job-sheet reader), `pay.ts` (what a job pays), `fares.ts` (bus and train cost), and one file per service.
- `src/views/` holds the four screens, `src/components/` the map, the import dialog and shared controls.
- `e2e/` holds the browser journeys. Nothing in them is mocked; the `[fault]` ones cut a service off on purpose to check the message a driver sees.
- The product name lives in `src/brand.ts`, `index.html` and `vite.config.ts`.

## Known limits

- Drive times are normal road speeds, not live traffic. Each collection and delivery allows 15 minutes.
- In solo mode the job order is chosen by road distance, not by timetable.
- A lift run assumes every driver starts in the car at the lift driver's start.
- Bus fares use the published single fare cap for England (£3 to the end of 2026, £2 in 2027), set in `src/lib/fares.ts`; update it when the cap changes. Train fares are a rough range from distance, because no free source of real ticket prices exists.
- Pay is worked out from the rates in the app, not taken from a payslip.
- Planning needs a connection. The app opens offline but does not keep the last plan.

## Contributing

Problems and ideas are welcome as GitHub issues. Please do not post screenshots of real job sheets: they contain personal details.

## Licence

MIT. See `LICENSE`. Map data © OpenStreetMap contributors (ODbL); other data credits are listed on the app's About page.

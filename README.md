# sundayrun.club

The website for Sunday Run Club in San Francisco: 9am, Golden Fire Hydrant, every Sunday.

## How it works

Nothing on the site is edited by hand except the list of events.

- `events.json` lists the Partiful event IDs, in any order.
- `scripts/build.mjs` reads each event's public Partiful page (title, date, poster), reads the shared Google Photos album, downloads the images and writes the site to `dist/`.
- The page decides which runs are upcoming and which are past when someone opens it, so a run moves into the poster wall once it ends, with no rebuild needed.
- `sundayrun.club/next` sends people to the first run that hasn't ended yet. `/photos` and `/chat` go to the album and the WhatsApp group.
- GitHub Actions rebuilds and deploys on every push and every 3 hours. If Partiful or Google Photos fails, the build fails and the last good site stays live.

## Adding events

After creating Partiful events (one or several at once):

```sh
node scripts/add-event.mjs https://partiful.com/e/AAAA https://partiful.com/e/BBBB
git commit -am "Add run club events" && git push
```

The `sunday-run-club` skill in Dewi's assistant repo does this automatically.

## Local build

```sh
node scripts/build.mjs
cd dist && python3 -m http.server 8000
```

Needs Node 22 or newer. No dependencies.

## Known limits

- Partiful has no public API. The build reads the data embedded in public event pages, so a Partiful redesign could break it.
- Google removed API access to shared albums in March 2025. The build reads the public album page instead, which Google could also change.
- GitHub pauses scheduled workflows in a repo with no commits for 60 days. Adding events keeps it active.

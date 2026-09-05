# SPM Cricket Auction — live cricket auction platform

An IPL-style player auction for district and corporate leagues: import a few hundred
players from a spreadsheet, retain a few, then run the room live while every phone in
the stands watches purses drain in real time.

- **Backend** — FastAPI, PostgreSQL, SQLAlchemy 2, JWT, WebSockets
- **Frontend** — React 18, TypeScript, Vite, Tailwind, Recharts
- **Tests** — 193 passing, covering the auction rules, HTTP layer, Excel import and live feed

---

## Run it

### Docker (everything at once)

```bash
git clone <your-repo> && cd cricket-auction
JWT_SECRET="$(openssl rand -hex 32)" docker compose up --build
```

- App — http://localhost:8080
- API docs (Swagger) — http://localhost:8000/docs
- Sign in with `admin@cricauction.com` / `admin123`, then change the password

### In VS Code (no Docker, no Postgres)

Open the folder, then **Terminal → Run Task → Install everything**, then
**Terminal → Run Task → Start the auction app**. Two terminals open: API on
:8000, web on :5173. Press F5 instead to run the API with breakpoints.

The tasks set `DATABASE_URL` to a local SQLite file, so nothing else needs installing.
Delete `backend/auction.db` to start over.

### Locally, without Docker

```bash
# --- API ---
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload        # runs on SQLite, nothing else to install

# Optional: a demo league with six squads and 420 players
python -m app.seed

# --- Web ---
cd ../frontend
npm install
npm run dev                          # http://localhost:5173, proxies /api to :8000
```

The first admin account is created on startup from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
**Change these before putting this on a network.**

**No database to install.** With no `DATABASE_URL` set, the API creates a SQLite file at
`backend/auction.db` and runs from that. Fine for setting up, rehearsing, and even a single
auction night — just copy the file somewhere safe afterwards.

For a real deployment set `DATABASE_URL` to a PostgreSQL URL; Docker Compose already does.
If you see `connection to server at "127.0.0.1", port 5432 failed`, something is pointing
at PostgreSQL when it isn't running — clear `DATABASE_URL` from your `.env` to fall back to
SQLite, or start PostgreSQL.

### Tests

```bash
cd backend && python -m pytest tests/ -q
cd frontend && npm run build          # tsc type-check plus production build
```

---

## How an auction night runs

1. **Setup → Create a league.** Name, season, venue, date.
2. **Setup → Artwork.** Upload the league mark, the tournament poster (the one you're already
   sharing on WhatsApp — prizes, dates, ground) and a **powered by** logo for your sponsor or
   club, with an optional link. The poster is shown whole on the home page rather than cropped;
   the credit appears in the footer of every page. Each image saves the moment you pick it.
   The site banner isn't here — it's fixed for the whole application.

3. **Setup → Auction settings.** Purse, squad limits, retention price, base price,
   increment, clock. Defaults match the brief: ₹100,000 purse, 15–18 players,
   ₹3,000 retentions.
4. **Setup → Squads.** Add teams with owner, captain, logo and squad colour. The logo shows
   on the purse board, the squad pages and beside every bid; square images work best, anything
   else is cropped to fit. Existing squads get an **Add logo** / **Change logo** button, so you
   can set them up now and add artwork later. The squad colour tints that team's bar on the
   purse board.
5. **Setup → Registration link.** Share `/register/<league id>` with players — there's a copy
   button, a WhatsApp share, and a QR code to print on a poster or entry pass. Anyone with
   the link can sign themselves up with no account. Nothing they submit reaches the auction
   pool until you approve it in the same panel, one at a time or all at once. **Close
   registration** shuts the form whenever you want, and reopens it just as easily.

   Or skip it and **Import the register**, or **Add a player** one at a time — that panel is
   for walk-ins and late entries, and it keeps the place and role between saves because they
   tend to arrive in batches from the same club. Players added this way go straight into the
   pool; only self-registrations need approving. Upload the `.xlsx`, optionally with a `.zip` of
   photos. You get back a report of what was added, what was skipped and why.
6. **Setup → Retentions.** Assign kept players; their price comes straight off the purse.
   This is locked once the auction starts.
7. **Console → Start the auction.** The pool is shuffled once, here, and that order is
   honoured from then on.
8. **Console → Next player**, then close the player one of four ways — **Sold**, **Unsold**,
   **Retained** (pick a squad; charges the retention price and counts against their cap) or
   **Not available** (absent or withdrawn, and reversible from the player's page). Sold itself
   works two ways:
   - **Bid up.** Tap the squad paddles to raise by the configured increment, then **Sold**.
     Paddles grey out for any squad that can't legally cover the next step.
   - **Record a finished sale.** If bids are called out loud in the room, skip the paddles:
     choose the squad, type the winning price, press **Sell**. Same purse and squad limits,
     and it still lands in the bid history and the export.

   Keyboard: `N` next, `S` sold, `U` unsold.
9. **Console → Add an unsold player to a squad.** For the tidying-up after the last player is
   called: search by mobile number or name, pick the squad, set a price, done. Only players
   who aren't already in a squad appear, the purse and squad limits still apply, and it lands
   in the bid history like any other sale — so the export and the archive show how they got
   there. Refused while anyone is still on the block.

10. When the pool empties, **Bring back unsold** opens another round with the leftovers
   reshuffled. **Close the auction** ends it.
11. **Dashboard → Export results** downloads a workbook with every player and every squad.

Everyone else just opens `/live`.

---

## The rules, and where they live

All of them are enforced in `backend/app/services/auction.py`, not in the routes, so the
HTTP layer can't accidentally bypass one.

| Rule | Behaviour |
| --- | --- |
| Random order, no repeats | Shuffled once at start; each player gets a queue position |
| A player is sold once | Status moves `AVAILABLE → ON_BLOCK → SOLD`; selling twice is rejected |
| Purse ceiling | A bid above a team's remaining purse is refused |
| Squad reserve | Below the minimum squad size, a team must keep back the base price for every slot it still has to fill — so it can't spend its way out of a legal squad. Toggle with `enforce_squad_reserve` |
| Maximum squad | Checked when bidding **and** re-checked at the moment of sale |
| Retention price | Deducted immediately; releasing refunds it |
| Retentions per squad | At most 2 by default, counted per squad and configurable in settings. Releasing frees a slot |
| Not available | Takes a player out of the pool without selling them. Restoring puts them at the back of the queue, so they don't jump straight back onto the block |
| Nothing is lost | Bids are an append-only ledger — undo writes a void marker instead of deleting |
| Undo | Last bid falls back to the previous team; last sale refunds the purse and returns the player to the pool |
| Survives refresh | All state lives in Postgres; the socket only pushes it |

The squad reserve is the one rule not in the original brief. Without it a team could buy
three expensive players, run dry and finish with an illegal squad — the minimum of 15
would be unenforceable by the time anyone noticed. It's on by default and can be switched
off in settings.

---

## The spreadsheet

Only **Player Name** is required. Headers are matched loosely — `Player Name`,
`player_name` and `PLAYERNAME` all work, as do several aliases per column.

| Column | Notes |
| --- | --- |
| Player Name | Required |
| Mobile Number | Non-digits stripped; duplicates within a league rejected |
| Place | |
| Role | `Batsman`, `Bowler`, `All Rounder`, `Wicket Keeper` — plus `bat`, `wk`, `ar` and similar |
| Jersey Number | |
| Age | |
| Batting Style / Bowling Style | Free text |

**Photos** upload as a single zip. Files match on normalised player name
(`ravi_kumar.JPG` → Ravi Kumar), then jersey number (`44.jpg`), then name prefix.
Anything unmatched is listed in the import report rather than failing the run.

Duplicate names and mobile numbers are reported per row and skipped, so re-running the
same sheet is safe.

---

## Layout

```
backend/
  app/
    models.py            SQLAlchemy schema
    schemas.py           Pydantic request/response contracts
    security.py          JWT, password hashing, admin dependency
    websocket.py         Per-league broadcast hub
    services/
      auction.py         The engine — every business rule
      importer.py        Excel parsing, photo matching
      state.py           The payload the live screens render
    routers/             auth, leagues, players, auction, analytics, content
    seed.py              First-run admin + optional demo data
  tests/                 30 tests
frontend/
  src/
    components/
      BlockCard.tsx      The player on the block
      Layout.tsx, ui.tsx
    lib/
      api.ts             Typed API client
      hooks.tsx          Auth, theme, live feed, countdown
      league.tsx         Which league is in focus
    pages/               Home, Leagues, Teams, Players, Live, Admin, AdminAuction, Content
```

---

## API

Swagger at `/docs`, ReDoc at `/redoc`. Public reads need nothing; everything that changes
state needs `Authorization: Bearer <token>` from `POST /api/auth/login`.

```
GET    /api/leagues                              List leagues
POST   /api/leagues                              Create a league            (admin)
GET    /api/leagues/{id}/settings                Auction settings
PATCH  /api/leagues/{id}/settings                Update settings            (admin)
GET    /api/leagues/{id}/teams                   Squads with live purses
POST   /api/leagues/{id}/teams                   Add a squad                (admin)
GET    /api/leagues/{id}/players                 The register              (admin)
POST   /api/leagues/{id}/registrations           Player signs themselves up (public)
GET    /api/leagues/{id}/registrations/status    Is the form open, how many so far (public)
GET    /api/leagues/{id}/registrations/lookup    Returning player by mobile (public, masked)
GET    /api/leagues/{id}/registrations           Review queue                (admin)
GET    /api/leagues/{id}/registrations/export.pdf  Printable register        (admin)
GET    /api/leagues/{id}/registrations/{r}/card.pdf The player's own card    (token)
POST   /api/leagues/{id}/registrations/{r}/approve  Approve, creating the player (admin)
POST   /api/leagues/{id}/players/import          Excel + photo zip          (admin)
POST   /api/leagues/{id}/players/retain          Retain players             (admin)
GET    /api/leagues/{id}/auction/state           The live room             (signed in)
GET    /api/viewer                               The shared watching login (admin)
POST   /api/viewer                               Set it; password shown once (admin)
POST   /api/leagues/{id}/auction/start           Shuffle and begin          (admin)
POST   /api/leagues/{id}/auction/next-player     Call the next player       (admin)
POST   /api/leagues/{id}/auction/bid             Place a bid                (admin)
POST   /api/leagues/{id}/auction/sell            Sell at a stated price     (admin)
POST   /api/leagues/{id}/auction/sold|unsold     Close the player           (admin)
POST   /api/leagues/{id}/auction/undo-bid        Void the top bid           (admin)
POST   /api/leagues/{id}/auction/undo-sale       Reverse the last sale      (admin)
GET    /api/leagues/{id}/analytics               Dashboard figures
GET    /api/leagues/{id}/results                 Full archive; contacts for admins only
GET    /api/leagues/{id}/export/results.xlsx     Download the results
WS     /api/leagues/{id}/auction/ws              Live feed
```

Socket events: `snapshot`, `player_called`, `bid_placed`, `bid_undone`, `player_sold`,
`player_unsold`, `auction_started/paused/resumed/completed`, `round_started`, `sale_undone`.
Each carries the full state and team board, so a client that misses one still recovers.
The client reconnects with backoff and polls over HTTP meanwhile, so the board is never
silently stale.

---

## Sound and celebration

When a player sells, both screens open a run of fire flowers on canvas and play a
three-second firecracker clip on the same tick, so the bang and the first bloom land
together. Seven shells fire across the first 1.6 seconds and the falling tails carry the
display to about three seconds, matching the audio.

Files live in `frontend/public/sounds/`:

| File | Plays when |
| --- | --- |
| `firework.mp3` | a player is sold |
| `unsold.mp3` | a player goes unsold (not supplied — silent until you add it) |
| `bid.mp3` | each bid lands (not supplied — silent until you add it) |

There is no synthesised fallback. A missing file means that cue is silent, which is easier
to reason about than a substitute sound appearing unannounced.

Browsers block audio until the visitor interacts with the page, so the first tap unlocks it
and preloads the clip. If a sale happens before decoding finishes, the cue plays the moment
it lands rather than being dropped — otherwise the first sale of the night could be silent.
There's a **Sound on/off** toggle in the header of both screens, and the fire flowers are
skipped for anyone whose system asks for reduced motion.

If you're putting this on a projector, open `/live` there and tap once anywhere to unlock
the audio before the first player is called.

### Using your own files

Keep the names above and drop replacements into the same folder, then hard-refresh.
`.wav`, `.ogg` and `.m4a` work too — change the extension in the `FILES` map at the top of
`src/lib/sound.ts`. Keep each clip to about three seconds; the auctioneer is already calling
the next player by then.

## Images

Every upload — player photos, team logos, league artwork — is decoded, resized and re-encoded
once, at the moment it arrives. The original is not kept.

This matters more than it sounds. A phone photo is around 8MB at 3024×4032; four hundred of
those is 3GB of disk, and a page showing twenty of them is 150MB down the wire, on ground
wifi, on auction night. None of that resolution ever reaches the screen. After optimisation
the same photo is about 20KB, so 400 players is roughly 8MB and that page is under half a
megabyte.

Longest edge by kind: player photos 900px, logos 600px, banners and posters 1600px. Logos keep
their transparency as PNG; photos are flattened onto white first, because converting a
transparent PNG straight to RGB turns it black. EXIF orientation is applied, so the portraits
phones record sideways come out upright. SVGs are left alone. Anything that can't be decoded
is stored exactly as sent rather than rejected — a player standing at a registration desk
shouldn't lose their entry to a fussy image parser.

## Where uploads live

Images go in the database, not on disk. On a rented server the filesystem would be fine, but
on managed hosting — Render, Railway, Fly — it is wiped on every redeploy, and the player
photos would go with it. Since images are optimised to roughly 20KB on the way in, a full
register of 400 players is about 8MB, which makes this cheap and removes the need for a
persistent disk or an S3 bucket.

`/uploads/...` is served by the app rather than a static mount: the database first, then disk
as a fallback so anything uploaded before this change still serves. Responses are cached for a
year, which is safe because filenames are random and content never changes under one.

There's a test that uploads photos, deletes the entire uploads directory, and asserts they
still serve — that is exactly what a redeploy does.

## Design

Night is the default — the room is dark and the screen is the floodlight. The palette
comes from the ground itself: pitch green-black, scoreboard amber, leather-red for unsold,
willow cream. Display type is tall and condensed like a scoreboard nameplate, and money is
always set in tabular mono so figures don't jitter as they change. The signature element is
the block card, where the player's jersey number becomes the backdrop numeral.

The banner across the top of the home page is part of the application, not a per-league
upload — it lives at `frontend/public/brand/` with the name and paths declared in
`src/lib/brand.ts`, so changing the product name or artwork is a single-file edit. Two
sizes ship and the browser picks by viewport width, since the home page is what everyone
opens first, often on ground wifi.

Three palettes ship, and the header button steps through them:

| Theme | Ground | Accent | Suited to |
| --- | --- | --- | --- |
| **Night** | pitch green-black | scoreboard amber | a dark hall, a big screen |
| **Day** | chalk white | deep amber | daylight, printing, screenshots |
| **Royal** | white | violet | projectors and bright halls, where dark themes wash out |

The registration page carries its own royal-blue palette regardless of the chosen theme — it's
the page strangers see first, usually on a phone in daylight, so it stays bright and calm
rather than borrowing the auction room's floodlit look. The site's theme is restored when they
leave. Every text pairing in it clears WCAG AA: body 16.7:1, muted 7.3:1, accent 6.7:1.

Two small components carry identity through the whole site: `LeagueMark` pairs a league's
name with its logo, and `TeamBadge` pairs a squad's name with its own. Both fall back to
initials when no artwork has been uploaded, so adding a logo later doesn't shift the layout.
Between them, a league is never named without its mark and a squad is never named without
its badge — including in passing, on the top bid, in the bid ladder and on the sold banner.

Each palette is four variables — `--pitch`, `--panel`, `--ink`, `--amber` — plus
`--on-accent` for the label that sits on the accent colour, and `--lift` for the panel
shadow that keeps light themes from going flat. Adding a fourth theme means adding one
block to `src/index.css` and one line to `THEMES` in `src/lib/hooks.tsx`.

Every combination that carries text was checked against WCAG AA (4.5:1): body, muted text,
money, the unsold red, and button labels on the accent. All three themes pass on every one.

## Deploying

One domain, one server, everything same-origin — no CORS, and the WebSocket works
without extra config.

```bash
# On a fresh Ubuntu VPS, with an A record pointing at its IP:
curl -fsSL https://get.docker.com | sh
git clone <your-repo> && cd cricket-auction
cp .env.prod.example .env && nano .env      # fill in every value
docker compose -f docker-compose.prod.yml up -d --build
```

Caddy fetches a certificate automatically. The app is then at `https://your-domain`,
Swagger at `https://your-domain/api/docs`.

Generate the secrets rather than inventing them:

```bash
openssl rand -hex 32     # JWT_SECRET
openssl rand -base64 24  # DB_PASSWORD and ADMIN_PASSWORD
```

Back up the database before auction night and after it:

```bash
docker compose -f docker-compose.prod.yml exec db \
  pg_dump -U auction cricket_auction > backup-$(date +%F).sql
```

## Forgotten the admin password?

**By email.** "Forgotten your password?" on the sign-in page sends a link that expires in 30
minutes and works once. Settings go in `backend/.env` — copy it from `.env.example` first,
since the example file itself is never read. It needs SMTP configured — with Gmail, an App Password rather than the
account password:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=you@gmail.com
APP_BASE_URL=https://your-domain.com     # where the emailed link points
```

The page answers identically whether or not the address has an account — a login page that
says "no such user" is a way of finding out who does. Only a hash of the token is stored, so a
copy of the database isn't a set of working reset links; asking again invalidates the previous
link; and a suspended account can't let itself back in.

**Without SMTP** the link is written to the server log rather than thrown away, so a
self-hosted install with no mail account still recovers — read it out of
`docker compose logs api`.

**From the command line**, which needs no email at all:

```bash
cd backend
python -m app.reset_password --list          # which accounts exist
python -m app.reset_password                 # new password for the admin, printed once
python -m app.reset_password --password mine # or pick your own
python -m app.reset_password --new-email you@gmail.com   # change the login id too
```

The admin address is set on first startup from `ADMIN_EMAIL` and never changes by itself, so
if the account was created with the default, `--new-email` is how you point it at a real inbox
without losing your data.

Under Docker: `docker compose exec api python -m app.reset_password`.

## Before you go live

- [ ] Set a real `JWT_SECRET` and change the admin password
- [ ] Point `DATABASE_URL` at a managed Postgres with backups
- [ ] Serve over HTTPS (the WebSocket needs `wss://`)
- [ ] Set `CORS_ORIGINS` to your domain only
- [ ] Consider S3 only if the register grows past a few thousand photos; below that the
      database holds them fine and survives redeploys
- [ ] Add Alembic for real migrations. `app/migrations.py` handles additive `ADD COLUMN`
      changes safely on boot, which covers new optional fields, but renames, type changes and
      drops still need a proper migration tool and a human watching

## Leagues, squads and results

Everything about a league lives inside it. `/leagues` lists them with **Upcoming**, **Live**
and **Completed** filters; `/leagues/<id>` is the league itself — its squads, who each one
holds, and the result once the auction is done; `/leagues/<id>/players` is its full register,
searchable and filterable by role, status and squad.

Browsing a result reads as a path: **Leagues → the league → a squad → its players and what
each cost**. A league page shows squads only — counts, spend, top buy — and the players appear
once you open a squad. Names aren't spilled across the league page, which keeps that page
readable and makes the squad the unit people actually care about.

An organiser can **edit any player** or **put a sold player back up for auction** from the
player's page: the squad is refunded and the player rejoins the pool at the back of the queue.
Unlike undo-last-sale, this reaches any purchase, not just the most recent — which is what you
need when a mistake surfaces three players later. Squads can be edited in Setup.

**The player register is for organisers.** `/players` and a player's own profile need an admin
login — a searchable directory of everyone who signed up, with their contact details, isn't
something to leave open. The public route to a player is through the result: league → squad →
who they hold and what each cost, which is the interesting part anyway.

The same page serves all three states, which is why there's no separate archive: an upcoming
league shows squads with empty lists, a live one fills up and refreshes itself every ten
seconds, and a finished one is the permanent record. Nothing is deleted when an auction ends.

Each player carries the registration they came from — when they signed up, what they said
about themselves, the photo they submitted. Players added by import have no registration and
simply show nothing there.

**One endpoint, two audiences.** `GET /api/leagues/{id}/results` is public, but the phone
number, email and free-text note only come back when the caller is a signed-in organiser.
A public archive of every player's contact details is not something to hand out by accident,
so there's a test asserting they appear nowhere in the anonymous payload, and another
asserting an invalid token is treated as the public rather than falling through to admin.

Old `/history` links redirect to the equivalent league page.

## Who can watch

The live room is behind a sign-in — bidding in progress is for the people in the auction, not
the whole internet. There is **one shared login** for all the squad owners, set by the
organiser in **Setup → Live viewing login**: an id, a generated password, and a copy button
that formats the message to send to the group. Up to 30 people can watch at once, set by
`MAX_LIVE_VIEWERS`; the thirty-first is turned away at the handshake rather than quietly
filling a room that then degrades for everyone. The organiser is always admitted, full or not.

A watching login is read-only, enforced server-side: selling, adding players, changing
settings and issuing logins all return 403. It doesn't show players' phone numbers either.

Issuing a new password replaces the old one immediately, which is how you shut out anyone who
shouldn't have it any more — everybody else just needs the new one. The password is shown once
and stored hashed, so if it's lost you issue another rather than recovering it.

The WebSocket carries the same JWT as a query parameter, since a browser can't set headers on
a socket, and an unauthenticated client is closed at the handshake rather than left waiting on
a connection that never sends anything.

**Finished results stay public.** `/leagues/<id>` and the player list need no account — only
the live room is gated, which is the part that's live.

## Contact details

Phone numbers are held back from every public response — the player list, profiles, the
archive and the live feed. The organiser's console always shows the number of the player on
the block, because that is the line read out in the room. Whether anyone else sees it is one
switch, **Setup → Artwork → Show mobile numbers**, off by default.

## Player self-registration

Players open `/register`, pick from the leagues actually taking entries, and sign up with no
account. The form starts with the **mobile number**, because that is the key everything else
hangs off: type a full number and, if that person has registered for any previous league,
their name, role, place, jersey and photo come back and fill themselves in. They check what's
there, change anything out of date, and submit. Signing up for a second season is a few taps.

Email and photo become optional on a repeat — leave them blank and the stored ones are reused,
with the photo referenced rather than copied, so a second entry costs no extra disk.

**The lookup is public, so it is deliberately narrow.** It needs the complete number, not a
fragment. It never returns the email address in full — only a mask like `r****r@example.com`,
enough for the player to recognise but not enough to harvest — and the real address is
substituted server-side on submit. Without that, the registration form would double as a way
to turn any phone number you happen to know into a name and an email.

The rest of the form  — or go straight to `/register/<league id>` if you've shared that link directly.
Only leagues that are **Upcoming** *and* open appear in the picker; a closed or finished
league on that list would just be a dead end.

When they finish they can **download a registration card**: a single-page A5 PDF with their
photo, registration number, role, place, jersey, contact details and status, plus the auction
date and venue. The link carries a per-registration token, so it works without an account and
opens that one card only — a token from one registration returns 403 on another, and there's a
test for exactly that. Organisers can fetch any card with their own login.
 The tournament poster runs
across the top of the form, so the link doubles as the advert. Required: player name,
mobile, email, place, role and **a photo** — the photo is what the room sees when they come
up for auction, and chasing it later is the organiser's problem. Jersey number and a free
note are optional.

Submissions land in a separate `registrations` table rather than becoming players directly,
which means:

- nobody unvetted can be called to the block by accident
- the review queue is a real queue, with approve, reject and approve-all
- adding this to an existing database creates a new table rather than altering the one
  holding live auction data

Duplicates are refused on both mobile and email — email is compared case-insensitively, so
`RAVI@example.com` won't get a second entry past `ravi@example.com`.

**Printing the register.** The admin panel has two PDF buttons — the tab you're looking at,
or everyone. The document is landscape A4 with a repeating header, one row per player with
their photo, mobile, email, place, role, jersey and status. It's admin-only, because contact
details on every row are the point of it. A photo that won't decode is skipped rather than
failing the export, and if rendering still fails the list is produced without photos rather
than erroring.

**Approving automatically.** A switch in the admin panel puts new sign-ups straight into the
auction pool with no review queue. Duplicate names and mobile numbers are still refused, so it
can only ever add someone new. Useful once you trust the link is only with players; switch it
off and everything waits in the queue again.

**Closing the form.** There are two switches. The organiser has an explicit
**Close registration** button in the admin panel, usable at any time and reversible; and
the form also shuts by itself once the league leaves **Upcoming**. The status endpoint
reports which of the two is in play, so the page can say *"the organisers have closed
entries"* rather than a flat "closed".

The public status endpoint exposes counts and state only — the roster of who has registered
needs an admin token.

There's a crude per-IP throttle (60 submissions per 5 minutes). It's deliberately generous
because a volunteer at a registration desk signs up dozens of players from one phone, and a
club often shares one connection. If the link goes on social media, put a real rate limiter
in front of it.

### Not built yet

Honest list, so nothing surprises you: bidding is placed by the auctioneer on behalf of
each squad rather than each owner bidding from their own phone; there's no sponsor or gallery UI at all — the
API endpoints exist and the pages can come back when you want them; the auction clock is displayed but doesn't
auto-close a player when it hits zero; there is no countdown clock — a player stays on the block until
the auctioneer closes them, which is deliberate, since auto-selling on a timer would be
dangerous on a wobbly connection; registrants aren't notified by SMS when they're
approved; and the registration throttle is in-process memory, so it resets on restart and
doesn't work across multiple API containers.

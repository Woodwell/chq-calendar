# Deploying a demo build

How to put an unreleased page in front of a reviewer who is not on your
network. Written for a droplet already running Caddy; nothing here is part of
the app, and it can be dropped from any upstream PR.

The demo is a static file tree — no runtime, no database, no backend. That is
what keeps this short.

## 1. Build

```bash
cd frontend && npm run build:demo
```

`build:demo` sets `VITE_DEMO=true` for the bundle only, not for the tests. It
stamps the banner on `/classes` with the git SHA and build time, and adds a
"Classes (demo)" link to the calendar's menu.

**Rebuild before every deploy.** The banner reports the commit it was built
from, so a stale `out/` tells your reviewer it is something it is not.

## 2. Stage the catalog

The published catalog is gitignored and exists nowhere else, so copy it to
where a production build looks for it:

```bash
mkdir -p frontend/out/cache/calendar-cache
cp frontend/public/data/classes-2026.json frontend/out/cache/calendar-cache/
```

Refresh it with `npm run sync:classes --workspace=chautauqua-backend` — a full
crawl takes about four minutes, or ten on the first run of a season when it
also has to learn every class's subjects.

## 3. rsync

```bash
rsync -av --delete --dry-run \
  --exclude='data/*.json' \
  --exclude='cache/calendar-cache/all-events-*.json' \
  --exclude='cache/calendar-cache/article-links-*.json' \
  --exclude='cache/calendar-cache/program-links-*.json' \
  --exclude='cache/calendar-cache/years.json' \
  frontend/out/ droplet:/srv/chqcal-demo/
```

Drop `--dry-run` once the file list looks right.

About 4.8 MB rather than 15 MB, because two things are excluded:

- **`data/*.json`** — 5.4 MB that production never requests. They ship only
  because Vite copies everything in `public/`. Note the exclude is
  `data/*.json`, not `data/`: `data/weekly-themes/` **is** fetched in
  production and has to stay.
- **The rest of `cache/calendar-cache/`** — another 4.5 MB that Caddy proxies
  from the live site instead of hosting.

## 4. Caddyfile

```caddyfile
demo.example.com {
	root * /srv/chqcal-demo
	encode zstd gzip

	# One password for the whole thing. Generate the hash with:
	#   caddy hash-password
	# On Caddy older than 2.8 the directive is `basicauth`.
	basic_auth {
		reviewer $2a$14$REPLACE_WITH_HASH
	}

	header {
		X-Robots-Tag "noindex, nofollow, noarchive"
		Referrer-Policy "no-referrer"
	}

	# The build ships the live site's robots.txt, which says `Allow: /`, and
	# a sitemap listing www.chqcal.org URLs. Neither belongs on a demo host,
	# so answer both here rather than shipping edited copies.
	handle /robots.txt {
		respond `User-agent: *
Disallow: /` 200
	}
	handle /sitemap.xml {
		respond 404
	}

	# The class catalog is ours and is the only thing under this prefix that
	# exists on disk. This must come before the proxy below.
	@classes path /cache/calendar-cache/classes-*.json
	handle @classes {
		file_server
	}

	# Everything else the app fetches from that prefix — events, article and
	# program links, the years manifest — comes from the live site.
	#
	# A proxy rather than a direct fetch because www.chqcal.org sends no CORS
	# headers, so the browser blocks a cross-origin request. Proxying keeps it
	# same-origin, and means the 4.5 MB events file never has to be copied
	# here.
	#
	# `header_up Host` is not optional: CloudFront answers 421 Misdirected
	# Request to a Host it does not recognise, and the calendar page then
	# renders empty.
	handle /cache/calendar-cache/* {
		reverse_proxy https://www.chqcal.org {
			header_up Host www.chqcal.org
		}
	}

	# Static pages. try_files resolves /classes to /classes/index.html, which
	# the Vite dev server does for you and a plain file server does not.
	handle {
		try_files {path} {path}/index.html {path}/
		file_server
	}

	log {
		output file /var/log/caddy/chqcal-demo.log
	}
}
```

Then `caddy reload --config /etc/caddy/Caddyfile` (or
`systemctl reload caddy`).

## Before the first deploy

- **DNS**: an A record for `demo.example.com` pointing at the droplet. Caddy's
  automatic HTTPS needs the name to resolve before it can get a certificate.
- **Password**: `caddy hash-password`, and paste the hash into the block above.
- **Directory**: `/srv/chqcal-demo` must exist and be readable by Caddy.

## Checking it worked

```bash
curl -u reviewer:PASSWORD -o /dev/null -w '%{http_code}\n' https://demo.example.com/classes/
curl -u reviewer:PASSWORD -o /dev/null -w '%{http_code}\n' https://demo.example.com/cache/calendar-cache/classes-2026.json
curl -u reviewer:PASSWORD -o /dev/null -w '%{http_code}\n' https://demo.example.com/cache/calendar-cache/years.json
curl -o /dev/null -w '%{http_code}\n' https://demo.example.com/            # expect 401
```

The third is the proxy: a 421 there means the `Host` header is not reaching
CloudFront correctly.

## Taking it down

Delete the site block and reload, or comment out `basic_auth` credentials to
lock everyone out immediately. The files can stay; without a Caddy site block
nothing serves them.

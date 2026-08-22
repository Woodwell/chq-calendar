# Deploying a demo build

How to put an unreleased page in front of a reviewer who is not on your
network. Written for the droplet's existing Caddy container at
`/opt/codeloft/caddy`. Nothing here is part of the app, and it can be dropped
from any upstream PR.

The demo is a static file tree — no runtime, no database, no backend — so it
needs no container of its own. The existing Caddy serves it from a mounted
directory.

## Paths, host and container

The one thing to keep straight. Caddy runs in a container, so every path in
the Caddyfile is a path *inside* it:

| Inside the container | On the droplet                              |
| :------------------- | :------------------------------------------ |
| `/etc/caddy/Caddyfile` | `/opt/codeloft/caddy/Caddyfile`           |
| `/srv/chqcal-demo`     | `/opt/codeloft/caddy/sites/chqcal-demo` *(new mount)* |
| `/var/log/caddy`       | `/opt/codeloft/caddy/logs`                |

rsync targets the droplet column; the Caddyfile refers to the container one.

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
ssh droplet 'mkdir -p /opt/codeloft/caddy/sites/chqcal-demo'

rsync -av --delete --dry-run \
  --exclude='data/*.json' \
  --exclude='cache/calendar-cache/all-events-*.json' \
  --exclude='cache/calendar-cache/article-links-*.json' \
  --exclude='cache/calendar-cache/program-links-*.json' \
  --exclude='cache/calendar-cache/years.json' \
  frontend/out/ droplet:/opt/codeloft/caddy/sites/chqcal-demo/
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
	# A container path — see the table above.
	root * /srv/chqcal-demo
	encode zstd gzip

	# One password for the whole thing. Generate the hash with:
	#   docker compose exec caddy caddy hash-password
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

Append this to the existing `/opt/codeloft/caddy/Caddyfile` — it is a new
site block alongside whatever is already there, not a replacement.

```bash
cd /opt/codeloft/caddy
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

## Before the first deploy

**Mount the site directory.** The container cannot see files that are not
mounted into it, so add one line to `/opt/codeloft/caddy/docker-compose.yml`:

```yaml
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - ./sites/chqcal-demo:/srv/chqcal-demo:ro   # <- add this
      - caddy_data:/data
      - caddy_config:/config
      - ./logs:/var/log/caddy
```

Read-only, because Caddy only ever serves these files.

Adding a volume needs the container recreated — a reload will not pick it up:

```bash
cd /opt/codeloft/caddy && docker compose up -d
```

Also before the first deploy:

- **DNS**: an A record for `demo.example.com` pointing at the droplet. Caddy's
  automatic HTTPS needs the name to resolve before it can get a certificate.
- **Password**: `docker compose exec caddy caddy hash-password`, and paste the
  hash into the site block above.
- **Directory**: create `sites/chqcal-demo` before `docker compose up -d`, or
  Docker creates it as a root-owned directory and rsync then fails.

Logging needs no change: `./logs` is already mounted, so
`/var/log/caddy/chqcal-demo.log` lands in `/opt/codeloft/caddy/logs/`.

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

Delete the site block from the Caddyfile and reload. The files can stay;
without a site block nothing serves them.

```bash
cd /opt/codeloft/caddy && docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

## An aside on the compose file

`network_mode: host` and the `ports:` block do not combine: with host
networking the container binds the host's ports directly and the `ports:`
mappings are ignored. Harmless, but it reads as though it is doing something.
Unrelated to the demo — worth a look when you are next in there.

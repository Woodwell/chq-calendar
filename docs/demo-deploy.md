# Deploying a demo build

How to put an unreleased page in front of a reviewer who is not on your
network. Written for the droplet's existing Caddy container at
`/opt/codeloft/caddy`. Nothing here is part of the app, and it can be dropped
from any upstream PR.

The demo is a static file tree, so it needs no container of its own — the
existing Caddy serves it from a mounted directory. It is not entirely
self-contained, though: the class catalog is fetched at request time from the
sandbox pipeline in AWS (step 2), and the calendar's events are proxied from
the live site. Neither has to be copied here, and neither is refreshed by
redeploying.

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

## 2. The catalog — nothing to stage

The demo does not ship a catalog. It fetches whatever the sandbox pipeline
last published, so a reviewer sees current spot counts rather than a snapshot
frozen at deploy time — and a redeploy is no longer the way to refresh data.

The path is `infrastructure/sandbox-classes` → S3 (private) → CloudFront →
Caddy → the page. Stand it up once:

```bash
terraform -chdir=infrastructure/sandbox-classes apply -var bucket_name=<your-bucket>
```

`terraform output catalog_url` then gives the domain the Caddyfile below
proxies, and `terraform output caddy_classes_block` prints that block with the
domain already filled in.

Refresh the data by running the pipeline, not by rebuilding:

```bash
aws lambda invoke --function-name chq-classes-sandbox \
  --payload '{"mode":"spots"}' --cli-binary-format raw-in-base64-out /dev/stdout
```

`spots` re-reads only the classes running soon — about 15 seconds. `full`
re-crawls the whole catalog and takes roughly four minutes. Both publish to
S3, and CloudFront caches for at most five minutes, so the demo catches up on
its own.

If you have edited `config/SpecialStudies.csv`, that changes the *compiled*
catalog rather than the crawl: rebuild it with `npm run build:catalog
--workspace=backend`, then redeploy the Lambda so the new file is bundled in.

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

About 3.9 MB rather than 9.8 MB, because of the first exclude:

- **`data/*.json`** — 5.9 MB that production never requests. They ship only
  because Vite copies everything in `public/`. Note the exclude is
  `data/*.json`, not `data/`: `data/weekly-themes/` **is** fetched in
  production and has to stay. `classes-2026.json` is in here too, and is
  meant to be excluded — the demo reads the catalog from AWS, not from a
  copy that would be stale the moment it landed.
- **`cache/calendar-cache/*`** — guards rather than savings. A demo build
  emits no `cache/` directory at all; these excludes only stop a hand-staged
  copy from an earlier deploy being served in place of the proxied original.

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

	# The class catalog comes from the sandbox pipeline's CloudFront rather
	# than from disk — see step 2. This must come before the catch-all proxy
	# below, which would otherwise send it to the live site, where it does
	# not exist.
	#
	# `header_up Host` for the same reason it appears below: CloudFront
	# answers 421 Misdirected Request to a Host it does not recognise, and
	# this distribution knows only its own name. Take the domain from
	# `terraform output catalog_url`.
	@classes path /cache/calendar-cache/classes-*.json
	handle @classes {
		reverse_proxy https://dXXXXXXXXXXXXX.cloudfront.net {
			header_up Host dXXXXXXXXXXXXX.cloudfront.net
		}
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

The second and third are both proxies now, to different origins, and they
fail in different ways:

- **classes-2026.json** goes to the sandbox distribution. `403` means
  CloudFront reached S3 but the bucket policy did not admit it — check that
  `aws_s3_bucket_policy.catalog` applied and that its `AWS:SourceArn` matches
  this distribution. `404` means the pipeline has not published yet; invoke
  the Lambda in `full` mode. `421` means the `Host` header is not reaching
  CloudFront as its own domain.
- **years.json** goes to the live site, and `421` there means the same thing
  about `www.chqcal.org`.

A quick way to tell a stale catalog from a broken one, since both look like
an empty page:

```bash
curl -su reviewer:PASSWORD https://demo.example.com/cache/calendar-cache/classes-2026.json \
  | head -c 120
```

`generatedAt` is the crawl's own timestamp in UTC, so it should be within an
hour or so of the last pipeline run — not of the last deploy.

## Taking it down

Delete the site block from the Caddyfile and reload. The files can stay;
without a site block nothing serves them.

```bash
cd /opt/codeloft/caddy && docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

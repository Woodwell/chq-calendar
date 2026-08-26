import { defineConfig, PluginOption } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'path';
import { existsSync, createReadStream } from 'fs';
import { execSync } from 'child_process';
import { buildSitemapXml, PUBLIC_PATHS } from './src/lib/sitemap';

/**
 * Rewrites a bare path to its index.html, e.g. /classes -> /classes/.
 *
 * Vite in MPA mode does not do this, and neither does a plain file server —
 * which is why the droplet's Caddyfile spells out `try_files {path}
 * {path}/index.html`. `root` differs by server: the dev server reads the
 * source tree, the preview server the build output.
 *
 * Returns the rewritten url, or null to leave it alone.
 */
function barePathRewrite(url: string | undefined, root: string): string | null {
  if (!url) return null;
  const urlPath = url.split('?')[0];
  if (urlPath.endsWith('/') || urlPath.includes('.')) return null;
  if (!existsSync(resolve(root, urlPath.slice(1), 'index.html'))) return null;
  return urlPath + '/' + url.slice(urlPath.length);
}

// In MPA mode, Vite doesn't resolve bare paths like /feedback to /feedback/index.html.
// This plugin adds that behavior so dev matches production (S3/CloudFront).
// Also mocks POST /api/feedback so CAPTCHA isn't required in local dev.
function devServerMiddleware(): PluginOption {
  return {
    name: 'dev-server-middleware',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Mock feedback endpoint — skip CAPTCHA in local dev
        if (req.url === '/api/feedback' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', () => {
            try {
              const { feedback } = JSON.parse(body);
              if (!feedback?.trim()) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Feedback is required' }));
                return;
              }
              console.log('[dev] Feedback received:', feedback.substring(0, 80));
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ message: 'Feedback submitted (dev mode)' }));
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid request body' }));
            }
          });
          return;
        }

        // Rewrite bare paths to their index.html (e.g. /feedback → /feedback/)
        const rewritten = barePathRewrite(req.url, __dirname);
        if (rewritten) req.url = rewritten;
        next();
      });
    },
  };
}

// Build version stamp: short git SHA of the deployed commit, or a timestamp
// fallback for environments without git. Baked into the bundle via `define`
// and emitted as version.json so the client can detect new deploys.
function resolveAppVersion(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return `build-${Date.now()}`;
  }
}

// Emits out/version.json at build time with the same value baked into the bundle.
function emitVersionJson(version: string): PluginOption {
  return {
    name: 'emit-version-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version }),
      });
    },
  };
}

// Emits out/sitemap.xml at build time from the canonical public route list.
function emitSitemapXml(): PluginOption {
  return {
    name: 'emit-sitemap-xml',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: buildSitemapXml(PUBLIC_PATHS),
      });
    },
  };
}

const APP_VERSION = resolveAppVersion();

/**
 * A demo build, set by `npm run build:demo` for the bundle only.
 *
 * It decides what is *in* the build, not just what the build says about
 * itself — see the `classes` entry below.
 */
const DEMO = process.env.VITE_DEMO === 'true';

/**
 * Serves the class catalog from the build output instead of proxying it.
 *
 * `/cache/*` is proxied to the live site, which is right for events and the
 * links feeds but wrong for the classes file: that one is not deployed
 * anywhere, so the proxy answers with S3's NoSuchKey and the page renders
 * empty. The droplet's Caddyfile carves the same exception out ahead of its
 * own proxy; this keeps `npm run preview` honest about what a demo host does.
 *
 * Also resolves bare paths to their index.html, which the dev server does via
 * `configureServer` and a preview server otherwise does not — so the demo's
 * own menu link to /classes answered 404 while /classes/ worked.
 *
 * Installed in the hook body rather than a returned callback, so it runs
 * before Vite's internal proxy rather than after it.
 */
function previewMiddleware(): PluginOption {
  const out = resolve(__dirname, 'out');
  return {
    name: 'preview-middleware',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? '';

        const rewritten = barePathRewrite(req.url, out);
        if (rewritten) {
          req.url = rewritten;
          next();
          return;
        }

        if (!/^\/cache\/calendar-cache\/classes-\d{4}\.json$/.test(path)) {
          next();
          return;
        }
        const file = resolve(out, path.replace(/^\//, ''));
        if (!existsSync(file)) {
          // Say which file is missing rather than letting it fall through to
          // the proxy, which answers with an S3 error that explains nothing.
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: `No catalog at ${file}. Stage it with: ` +
              'mkdir -p out/cache/calendar-cache && cp public/data/classes-2026.json out/cache/calendar-cache/',
          }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        createReadStream(file).pipe(res);
      });
    },
  };
}

// Proxy config shared between dev server and preview server.
// Routes API/auth requests to the local backend (port 3001) and
// cache requests to the production CDN.
// NOTE: In dev mode, POST /api/feedback is intercepted by devServerMiddleware
// (CAPTCHA-free mock) and never reaches the proxy. The backend route is only
// proxied in preview mode or when using VITE_API_URL for direct access.
const backendProxy = {
  '/auth': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
  '/admin/api': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
  '/api': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
  '/cache': {
    target: 'https://www.chqcal.org',
    changeOrigin: true,
  },
};

export default defineConfig({
  appType: 'mpa',
  plugins: [
    devServerMiddleware(), previewMiddleware(), preact(),
    emitVersionJson(APP_VERSION), emitSitemapXml(),
  ],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(APP_VERSION),
    // Demo builds show when they were made; a preview nobody can date is
    // worse than no preview.
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@shared': resolve(__dirname, '../shared'),
    },
  },
  build: {
    outDir: 'out',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        feedback: resolve(__dirname, 'feedback/index.html'),
        // /classes is built only into a demo build. Listing it here
        // unconditionally put it in `out/` for every production deploy, and
        // `aws s3 sync out/` then published it: unlinked, but live, with a
        // canonical URL of https://www.chqcal.org/classes and a robots.txt
        // saying `Allow: /`. The demo flag was gating the menu link and the
        // banner, never the page itself, so "premature while /classes is
        // still being reviewed" was true of the link and false of the page.
        ...(DEMO ? { classes: resolve(__dirname, 'classes/index.html') } : {}),
        privacy: resolve(__dirname, 'privacy/index.html'),
        support: resolve(__dirname, 'support/index.html'),
        about: resolve(__dirname, 'about/index.html'),
        'about-iphone': resolve(__dirname, 'about/iphone/index.html'),
        'about-web': resolve(__dirname, 'about/web/index.html'),
        'admin-login': resolve(__dirname, 'admin/login/index.html'),
        admin: resolve(__dirname, 'admin/index.html'),
        'admin-feedback': resolve(__dirname, 'admin/feedback/index.html'),
        'admin-publishers': resolve(__dirname, 'admin/publishers/index.html'),
        'admin-publisher-events': resolve(__dirname, 'admin/publisher-events/index.html'),
        publish: resolve(__dirname, 'publish/index.html'),
        'publish-test': resolve(__dirname, 'publish/test/index.html'),
        'publish-apply': resolve(__dirname, 'publish/apply/index.html'),
        'publish-docs': resolve(__dirname, 'publish/docs/index.html'),
        'publish-verify': resolve(__dirname, 'publish/verify/index.html'),
        'publish-login': resolve(__dirname, 'publish/login/index.html'),
        'publish-status': resolve(__dirname, 'publish/status/index.html'),
        'publish-email-change-verify': resolve(__dirname, 'publish/email-change/verify/index.html'),
        'publish-email-change-cancel': resolve(__dirname, 'publish/email-change/cancel/index.html'),
      },
    },
  },
  server: {
    port: 3000,
    watch: {
      usePolling: true,
    },
    proxy: backendProxy,
  },
  preview: {
    port: 3000,
    proxy: backendProxy,
  },
});

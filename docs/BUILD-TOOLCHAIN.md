# Build toolchain and npm lifecycle review

Use Node 24.x (`nvm use` reads `.nvmrc`) and `npm ci`. The Node engine is deliberately bounded: the earlier open-ended range allowed Vercel to select Node 26 despite the project's 24.x setting. `package-lock.json` remains the source of dependency versions. Review changes to lifecycle-bearing versions before approving them with npm's `install-scripts` commands.

The Linux x64 build uses these version-specific lifecycle approvals:

- `@embedded-postgres/linux-x64@18.6.0-beta.19`: restores relative links from the package's `native/pg-symlinks.json`, needed by its embedded PostgreSQL libraries in development and tests. Other platform packages are not pre-approved; review them on their own platforms.
- `esbuild@0.28.2`: locates and validates the platform binary used for the service-worker bundle and tests. If the optional binary is absent it can invoke npm or download a binary from the npm registry; the script checks the binary against its packaged hash.
- `unrs-resolver@1.12.2`: the ESLint resolver's `napi-postinstall` helper locates its platform binding and can fall back to npm or a registry download when missing. Its direct download extracts a binary without an additional hash check in the helper. On the verified Linux install the locked optional binding is present and no fallback is needed.

`npm ci --foreground-scripts --strict-allow-scripts` verifies the approvals on the current platform with a recent npm 11. Other platforms may report additional unreviewed scripts, such as their embedded-postgres package or `fsevents`; do not grant broad approval without review.

Vercel's earlier logs reported `Unknown env config "cache-dir"`. There is no project `.npmrc` or repository setting for it. An injected `npm_config_cache_dir` reproduces the warning with npm 11, and other Vercel users have reported the same build-image variable. Its exact origin in this project has not been independently verified. The Vercel install and build commands remove only the unsupported lower- and uppercase environment variables from their npm processes; the supported npm `cache` setting and other environment variables are untouched. Validate the next Vercel build log: project-level command overrides or platform-internal npm calls could bypass these commands. The change does not silence other npm warnings.

The prebuild still checks the proxy route inventory and builds the timetable service worker. `lib/auth/package.json` declares the existing auth files as ES modules so Node can import the route inventory without syntax detection warnings; it does not make the whole repository ESM. `npm run sw:check` checks the generated worker for drift.

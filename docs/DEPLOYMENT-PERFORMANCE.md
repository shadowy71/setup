# Deployment performance investigation

## Evidence and scope

The measurements below are individual observations, not a controlled benchmark or a promise of deployment speed. Vercel's event timestamps compare the parent commit with the toolchain commit and a later build. They include different cache states. The build machine was reported as 2 cores / 8 GB in each example.

| Deployment | Build start to ready | Dependency phase | Cache and build observations |
| --- | ---: | ---: | --- |
| [Parent 05aac19, production](https://vercel.com/tf-68fa/setup/Bgm4RSNHgDhn6N691b8gzCmN3EEr) | 23.5 s | 1.2 s from install start to Next detection; npm reported `up to date in 992ms` | Restored prior build cache; open engine selected Node 26; Next compile 4.7 s. |
| [ef92f8b, preview](https://vercel.com/tf-68fa/setup/GopxJRDuPwwifdvmys8TLb8onxnG) | 112.2 s | 75.2 s from install command to Next detection | Vercel explicitly skipped the cache because Node changed from 26.x to 24.x; Next compile 19.0 s. |
| [88a16b2, production](https://vercel.com/tf-68fa/setup/49D9H7yodS79nce65g7Zvb9gu6ga) | 100.6 s | 79.8 s from install command to Next detection | Restored a previous Node 24 build cache; Next compile 3.3 s. |

The persistent bottleneck shown by these logs is dependency installation. Before the change Vercel's default install reused an existing dependency tree; `npm ci` removes `node_modules` and recreates the locked tree on every run, even when Vercel restores it. The first Node change also invalidated the prior build cache, but the later log demonstrates that cache restoration alone does not avoid the install cost. These logs do not establish how much of the install time is network, extraction, audit, or cache location individually. Removing the unsupported `npm_config_cache_dir` variables does not explicitly disable npm's supported `cache` setting, but it also does not direct npm to a cache known to survive between builds. The custom build command still calls `npm run build` exactly once; it does not bypass Next's build cache.

The change keeps `npm ci --include=dev` and its lockfile/integrity checks, but points npm's supported `cache` setting to `.next/cache/npm` and adds `--prefer-offline` so cached package content can be reused without freshness checks. Missing content can still be fetched and npm audit remains enabled. Vercel's [Next builder cache manifest](https://github.com/vercel/vercel/blob/main/packages/next/src/index.ts) includes `.next/cache/**` as well as `node_modules/**`; the deployment must be checked to confirm the platform restores and saves the new cache in practice. The first build will be cold, and cache upload/download costs can offset savings. Node 24 remains pinned. The unsupported cache-dir variables remain unset and no new package scripts are approved.

A local Linux x64 experiment with Node 24.22.3 and npm 11.21.2, a fresh cache, `npm ci --include=dev --prefer-offline --foreground-scripts --strict-allow-scripts --timing`, and then the same clean install against that cache took **72.7 s cold / 20.0 s warm**. These runs include audit and are not Vercel timings. The cache was 268 MiB after installation and remained present after a local Next build. Timings varied and the second install also deletes/recreates `node_modules`; the comparison is not an isolated causal estimate. Postinstall timings totaled about 0.20 s cold / 0.24 s warm on that machine; the approved PostgreSQL symlink hydration, esbuild binary validation and resolver binding check are not a plausible explanation for a minute-long regression in that experiment. The Vercel logs do not expose individual lifecycle timings, so fallback downloads there cannot be ruled out.

## Prebuild and generated output

`npm run build` executes the existing prebuild before Next:

1. `check-proxy-routes.mjs` synchronously walks the `app` directory once, reads directory entries (not every file's content), collects `page` and `route` paths, rejects unsupported parallel/catch-all segments, and sorts and compares them to the imported proxy inventory. The local `lib/auth/package.json` added by ef92f8b prevents Node's prior ESM syntax-detection reparse warning. A mismatch fails the build.
2. `build-sw.mjs` invokes esbuild on the timetable worker entry and its imports into an in-memory, classic IIFE for the browser. It reads the committed `public/timetable/sw.js`, compares the complete generated text, and writes only if missing or different. `--check` instead fails on missing or stale output. The 15.3 KiB generated file is deliberately tracked and checked for drift; an unchanged file is not rewritten, although esbuild still bundles it on every build.
3. Next compiles and Vercel packages the output.

The same prebuild commands existed before ef92f8b. In the later Vercel production log the whole prebuild occupied approximately 0.13 s; the service worker reported already current. An input-hash cache would add invalidation and stale-output risks for negligible measured benefit, so generation and validation remain intact. Changes to the entry, transitive imports, esbuild version or build options are still reflected by every build.

## Expected pipeline and follow-up

**Before this optimization:** restore Vercel build cache when compatible → clean `npm ci --include=dev` using npm's configured/default cache → proxy validation and in-memory SW bundle/conditional write → Next build → Vercel output and cache.

**After:** the same pipeline, except the clean install uses the npm content cache under `.next/cache/npm` and prefers cached content. A missing, invalidated or evicted cache remains safe: npm downloads locked packages and checks integrity. No additional lifecycle commands are introduced.

To measure impact, compare several successful same-branch, same-Node, same-machine preview deployments after one cache-warming deployment. Record install start/end, total build/ready time, cache restore and save time, cache size, and errors or fallback downloads. Compare against multiple prior warm-cache deployments; do not infer a Vercel improvement from the local test. If cache transfer or eviction makes builds slower, reconsider the cache location after measuring.

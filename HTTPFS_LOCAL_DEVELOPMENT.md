# Local HTTPFS development for DuckDB-Wasm

Build DuckDB-Wasm and HTTPFS together when changing the browser HTTP transport.
HTTPFS is a separately loaded Wasm side module, and both modules must use the
same DuckDB core revision, Emscripten toolchain, and platform settings.

## Required changes in both repositories

The browser provider in DuckDB-Wasm now uses only DuckDB core's `HTTPParams`,
`HTTPClient`, and request-info types. It no longer defines or allocates a copy
of HTTPFS's private `HTTPFSParams` structure. Request headers are forwarded
without merging them a second time.

This requires the companion browser adapter in `duckdb-httpfs`. That adapter
inherits from `HTTPFSUtil`, owns HTTPFS parameter initialization, and delegates
client creation to the existing Wasm provider. HTTPFS also needs the native
OpenSSL/curl discovery guards and the `__EMSCRIPTEN__` source guards.

Point the build at an HTTPFS checkout containing those changes. The HTTPFS
commit currently pinned by DuckDB core does not contain this adapter; merely
enabling the pinned extension is insufficient.

The adapter addresses the interface mismatches investigated in `duc-4z01`:
an outdated parameter layout copied across the module boundary, and an
HTTPFS-specific cast applied to the core-only Wasm provider.

## Configure and build matching modules

From the DuckDB-Wasm repository, activate the Emscripten environment used for
the main module and install the repository's JavaScript dependencies. The
commands below assume the main HTTPFS checkout is a sibling directory:

```shell
export DUCKDB_HTTPFS_DIRECTORY="$(cd ../duckdb-httpfs && pwd)"
export USE_GENERATED_EXPORTED_LIST=no
yarn install --frozen-lockfile
```

`extension_config_wasm.cmake` includes DuckDB's HTTPFS configuration:

```cmake
include("${EXTENSION_CONFIG_BASE_DIR}/httpfs.cmake")
```

This allows DuckDB's extension loader to honor `DUCKDB_HTTPFS_DIRECTORY`.
Do not add a duplicate direct `duckdb_extension_load(httpfs)` declaration;
an earlier declaration can prevent the source configuration from taking effect.

If an existing nested build was configured with a fetched HTTPFS checkout,
reconfigure it first. Do this for each variant whose nested build already
exists:

```shell
cmake -S submodules/duckdb \
    -B build/relsize/base/third_party/duckdb/src/duckdb_ep-build

cmake -S submodules/duckdb \
    -B build/relsize/threads/third_party/duckdb/src/duckdb_ep-build
```

Verify that configuration reports HTTPFS loading from the intended local
directory. For a fresh build, skip that reconfiguration step and let the
top-level build create the nested directories.

Build both main modules and explicitly build their extension repositories:

```shell
make build_loadable TARGET=base
cmake --build build/relsize/base/third_party/duckdb/src/duckdb_ep-build \
    --target duckdb_local_extension_repo --parallel 8

make build_loadable TARGET=threads
cmake --build build/relsize/threads/third_party/duckdb/src/duckdb_ep-build \
    --target duckdb_local_extension_repo --parallel 8

yarn workspace @duckdb/duckdb-wasm build:release
```

The extension artifacts are placed under:

```text
build/extension_repository/<duckdb-revision>/wasm_base/httpfs.duckdb_extension.wasm
build/extension_repository/<duckdb-revision>/wasm_threads/httpfs.duckdb_extension.wasm
```

Keep `DUCKDB_HTTPFS_DIRECTORY` set throughout configuration and rebuilding.
Develop in the persistent HTTPFS checkout: DuckDB's patch step can reset and
clean fetched extension sources below `build/`.

## Run the browser regression

The dedicated Chrome test exercises both `base` and `threads` with matching
local extension artifacts:

```shell
yarn workspace @duckdb/duckdb-wasm test:chrome:httpfs
```

It covers CSV and Parquet reads before and after loading HTTPFS, repeated
loads and requests, exactly-once secret/setting headers, a signed S3 request
to a local fixture, and browser client-selection errors. It requires the
existing `data/uni/studenten.parquet` test fixture.

To include the original live HTTPS reproduction:

```shell
HTTPFS_HTTPS_URL=https://blobs.duckdb.org/nl-railway/services-2025-03.csv.gz \
    yarn workspace @duckdb/duckdb-wasm test:chrome:httpfs
```

Each test has a 90-second deadline that terminates a hung worker and reports
the active stage. The harness sets the cross-origin isolation headers needed
by the threaded bundle and allows the locally built unsigned extensions.

The browser tests were validated with Node.js 24. The local Node.js 26
installation could not load the current Puppeteer dependency tree.

## Use the local web shell

The local app provider enables unsigned extensions when opening the database
and uses the extension repository on the application's origin:

```tsx
<DuckDBProvider
    config={{
        allowUnsignedExtensions: true,
        extensionRepository: `${window.location.origin}/extension_repository`,
    }}
>
```

This configuration is for trusted local development artifacts. Keep signature
verification enabled when publishing a production application. SQL cannot
enable unsigned extensions after the database has opened.

After rebuilding the Wasm package, rebuild the application. Copy the extension
repository after the app build, because the build recreates its output:

```shell
yarn workspace @duckdb/duckdb-wasm-app build:release
mkdir -p packages/duckdb-wasm-app/build/release/extension_repository
cp -R build/extension_repository/. \
    packages/duckdb-wasm-app/build/release/extension_repository/
npx http-server packages/duckdb-wasm-app/build/release \
    -c-1 -a 127.0.0.1 -p 8081
```

Open `/original.html` using the address printed by the server. Use a fresh
browser tab so an older worker does not retain stale modules. The simple
server command is sufficient for the base bundle; threaded use also requires
cross-origin isolation headers.

Run the original scenario:

```sql
CREATE TABLE before_httpfs AS
FROM 'https://blobs.duckdb.org/nl-railway/services-2025-03.csv.gz';

INSTALL AND LOAD httpfs;

CREATE TABLE after_httpfs AS
FROM 'https://blobs.duckdb.org/nl-railway/services-2025-03.csv.gz';

SELECT
    (SELECT count(*) FROM before_httpfs) AS before_count,
    (SELECT count(*) FROM after_httpfs) AS after_count;

SELECT 42;
```

Both counts should match. Confirm the extension's loaded state with:

```sql
SELECT extension_name, loaded
FROM duckdb_extensions()
WHERE extension_name = 'httpfs';
```

## Troubleshooting and recorded validation

| Symptom | Check |
| --- | --- |
| Extension download returns 404 | Build `duckdb_local_extension_repo`, copy its output after the app build, and verify the requested revision/platform path. |
| CMake requires native OpenSSL or curl | Verify that the companion HTTPFS checkout has the Emscripten build guards. |
| Compilation requests `curl/curl.h` | Verify that HTTPFS C/C++ guards use `__EMSCRIPTEN__`, while CMake uses `EMSCRIPTEN`. |
| HTTPFS changes disappear | Move development out of the generated FetchContent directory and set `DUCKDB_HTTPFS_DIRECTORY`. |
| The browser uses an old module | Rebuild the main module, extension repository, JavaScript package, and app; restart with caching disabled and use a fresh tab. |
| Reading after loading HTTPFS traps | Verify both repositories contain the coordinated adapter changes and that the main/side artifacts use matching core and toolchain revisions. |

The initial investigation fixed a missing-artifact 404 before uncovering the
post-load function-table trap. A successful extension download alone does not
validate the HTTP transport.

On October 13, 2026, the exact HTTPS scenario passed three consecutive runs
on each variant with the coordinated implementation and standard release
bundles. One earlier threaded run timed out while loading HTTPFS after the
first `CREATE TABLE`; that intermittent timeout remains unexplained.

Generated build artifacts, browser logs, and local credentials should not be
committed.

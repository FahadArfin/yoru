# Desktop reader host

Yoru's website and accounts remain on ChatGPT Sites. A dedicated `yoru-reader` Docker Compose project on the owner's PC supplies chapters and temporarily caches images. R2 is not used. The PC must stay awake, connected to the internet, with Docker Desktop running.

## Daily controls

Docker Desktop shows two containers: `suwayomi` and `bridge`. Both restart when the Docker engine starts unless they were explicitly stopped. From this checkout in PowerShell:

```powershell
.\scripts\reader-host.ps1 Status
.\scripts\reader-host.ps1 Start
.\scripts\reader-host.ps1 Stop
```

`Restart` restarts the existing containers; `Logs` shows the bridge's connection status. These commands keep the volumes. Do not use `down --volumes` to stop the service. Docker Desktop's “Start when you sign in” option can start the engine after login; Windows sleep still makes the reading server unavailable.

Secrets are in `%LOCALAPPDATA%\Yoru\reader\.env`, outside the repository. `READER_BRIDGE_KEY` is a random 32-byte secret shared with Sites. `SUWAYOMI_PASSWORD` is a separate random password for Suwayomi's `yoru` account. Neither value is shipped to visitors. Back up this file privately. Changing the bridge key requires updating the Sites secret and deploying a saved version, then recreating the bridge container.

Suwayomi's authenticated API and bundled administration WebUI bind to `127.0.0.1:4567`; the authenticated bridge binds to `127.0.0.1:4568`. Open `http://127.0.0.1:4567` on the host PC to manage sources. Sign in as `yoru` with the existing `SUWAYOMI_PASSWORD` from the private environment file above. The bundled WebUI matches the pinned server; automatic UI updates remain disabled. Only the bridge's fixed manga-reading operations pass through the tunnel; administration, extension installation, arbitrary GraphQL and arbitrary URL fetching are unavailable publicly.

## Sources and caching

Reader catalog placement starts with the shared Yoru/Ara Ara defaults in
`shared/catalog-preferences.js`, captured from the owner's provider selections.
Membership is keyed by provider name and covers all its language editions. Unknown
new providers start disabled in both lists. Settings offers independent personal
switches and **Reset to site defaults**. Signed-in choices are stored per account
in SQLite or D1 and refresh on focus and every 30 seconds; guest choices remain in
the browser. Legacy browser choices are retained as guest overrides. Changes apply
to supported chapter source pickers, chapter lists, reader links and preloading.
Placement does not install extensions or prove upstream availability. Both sections
default to **All sources** (`all`); **MangaDex + Weeb Central** (`core`) retains the
dedicated adapters, and **Suwayomi extensions** (`extensions`) selects the generic
catalogs. Global reset restores memberships and both modes. Ara retains its
confirmation gate, and Yoru retains per-title non-explicit eligibility.

The title page and reader both offer source choices. Translations default to English; the reader's Chapters panel can request another available language or all languages. Local imports remain a separate “On this device” choice. An explicit remote selection never falls back to unrelated imported pages during an outage. Partial source discovery is visible and has a retry button.

- MangaDex uses its official API, credited chapter editions and its image service through the bridge.
- Weeb Central uses the installed Suwayomi extension `eu.kanade.tachiyomi.extension.en.weebcentral` from the configured Keiyoushi store. The current installation was verified with version 1.6.25. Extensions are third-party code; review updates before installing them. Automatic extension updates and challenge-solving services are disabled.
- MALSync supplies exact MAL-to-source links. Matching also checks the source's returned URL and manga ID. Similar names alone are insufficient. Chapter ownership is checked again before images or chapter activity writes.
- Generic `suwayomi:<decimal-source-id>` catalogs coexist with the dedicated paths, including generic MangaDex and Weeb Central. The retained installed preflight lists 176 external source/language entries across 21 providers; these are declarations, not 176 verified readers. A provider-native title has a stable stored `ext-manga-*` identity, with exact `ext-chapter-*` editions, even without a MAL match. Local numeric bindings are checked against canonical ownership and the bridge instance after a reindex/restore.
- Official publisher redirects stay external. The reader does not retrieve their pages, bypass payment, or defeat access challenges. An extension's availability is not a grant of redistribution permission; source terms and removals still apply.

The three persistent volumes are:

| Volume                       | Contents                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `yoru-reader_suwayomi-data`  | Suwayomi database, installed extension and stable chapter identities                   |
| `yoru-reader_suwayomi-cache` | Suwayomi's temporary page cache; 1 GiB target, 72-hour expiry                          |
| `yoru-reader_bridge-data`    | Verified mappings and manifests, plus a separate 1 GiB image cache with 72-hour expiry |

Images are fetched only when requested by a reader. No whole-catalog download or chapter pre-download job runs. Cleanup runs on cache writes and every 15 minutes while the host is running, including after startup. Metadata and database size are separate from the approximately 2 GiB image budget. Browser image caching lasts five minutes. Cached images do not guarantee offline reading: the current source identity and page manifest must still be valid. Source removals are rechecked as the short metadata/page-list caches expire. To immediately retire a source, stop the bridge, remove its selection in the adapter, and clear the dedicated caches before restarting; preserve `suwayomi-data` unless intentionally resetting all source identities.

Generic metadata caches have age/byte bounds and retain explicit stale state. Permanent canonical title/edition identities and account preferences are not eviction candidates. Aggregate discovery permits at most four source-page operations, two concurrent provider operations and 12 seconds; generic and dedicated Weeb calls share one serialized Suwayomi queue with a pending-work cap. The bridge retains its 12-active-request cap, 500-page chapter limit and image MIME/byte validation. Cursors expire after 30 minutes, with a 2 KiB request and 1 MiB continuation-state bound. Destination, current membership and canonical ownership are checked before same-origin image bytes, including cache hits.

## Temporary public connection

The bridge uses a [Cloudflare Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/). Its random HTTPS address registers with Yoru every 45 seconds using the shared secret. Sites forgets the address after three minutes without renewal. A recreated tunnel registers its replacement automatically, so a PC or container restart does not require a new frontend publication. The cloudflared image supplies its trusted CA bundle; TLS validation remains enabled.

The bridge now checks its public tunnel every 45 seconds through an authenticated,
uncached `/health` endpoint that identifies the running bridge instance. This check
does not query manga providers. Only a healthy address renews its registration.
Three consecutive failed checks trigger a tunnel-only reconnect, with a two-minute
startup grace period. A successful check resets the failure count. Startup stalls
also reconnect; an unresponsive tunnel process is force-stopped after five seconds.
Process-start retries back off from 10 to 60 seconds. Website registration failures
are retried without rotating a healthy tunnel. Recovery normally takes a few
minutes once internet access is available; this cannot prevent outages during PC
sleep, Docker shutdown, or a Cloudflare service outage. Suwayomi and stored reading
data are not restarted or cleared by this recovery.

The bridge uses Cloudflare DNS (`1.1.1.1` and `1.0.0.1`) for external names;
Docker still resolves the internal `suwayomi` service. This avoids the observed
host-inherited resolver returning `ENOTFOUND` for valid new Quick Tunnel names.

Quick Tunnels are intended for testing, have no uptime guarantee and a 200 in-flight-request limit. This is the temporary PC pilot requested by the owner. Move to a named tunnel or a secured HTTPS endpoint for the permanent server. The bridge permits 12 concurrent operations; transient failures show a retry/source choice rather than a fabricated chapter list.

Sleep, network loss, Docker shutdown, registration expiry and provider outages can make reading unavailable even when the website still loads. Last-good metadata is labeled stale and does not imply that pages can be read offline. Unsupported, empty, unavailable, authentication-required, access-challenged and rate-limited states remain distinct; respect retry guidance and do not bypass upstream restrictions.

## Generic release and recovery

Generic operations require `READER_EXTENSIONS_ENABLED=1` separately in the app and bridge. Defaults remain disabled, and core adapters remain available with the generic flag off. Compose must persistently forward the flag to **bridge**; an `--env-file` supplies interpolation values and does not automatically inject arbitrary variables into a container. Compose now forwards `READER_EXTENSIONS_ENABLED: '${READER_EXTENSIONS_ENABLED:-0}'` under bridge. The October 19 release verified private flag 1 in the rebuilt bridge and Sites environment revision 4.

Publish a compatible generic-disabled Sites baseline retaining all destination/account/social filters before admitting Ara-native production records. Version 106 is not a safe app rollback target after such records exist. Recovery disables generic discovery/reading while retaining additive migrations, canonical identities, account records and destination filters. Preserve the prior bridge image and the exact validated new image, plus the compatible disabled Sites version. Recreate only the bridge with `up --detach --build --no-deps bridge`; preserve Suwayomi and every volume. `Restart` does not rebuild an image.

The October 19 release is source `635cd598ac82181fbb16b4c7e644c942b1e8425a`, Sites v108/environment revision 4, with compatible disabled rollback v107/environment revision 3 retained. Final bridge image `sha256:6d56c897575ea7c8650738d40f5feb15675ea733cac12c3c6ca9fa7cf1955410` is tagged `yoru-reader-bridge:validated-task14-635cd59`; both preceding images remain retained. Suwayomi container/image and all three volumes were unchanged. The [acceptance record](qa/enabled-reader-catalogs-acceptance.md) retains exact archives, deployments, image/source hashes and public operation results, and links all 23 controller rulings. Dedicated Weeb Central and generic Webtoons exact pages/cache were demonstrated; this does not certify every installed source. The second additional provider and real Ara reading matrix remain incomplete, selected MangaDex is publisher-external, and GitHub CI was blocked before steps by billing/spending limits. A fixture test, installed-source inventory or image build does not prove a working real provider or a deployed release. Keep private endpoints, credentials, environment files and raw provider material out of those records.

## Move to the personal server

1. Stop this Compose project before taking a consistent backup of its three named volumes. Keep the private environment file with that backup using secure storage.
2. Install Docker on the server, check out the same Yoru revision, and restore the volumes with the same names and UID/GID 1000 ownership. Keep `suwayomi-data`, bridge binding/identity records and additive app identity/account tables. Existing dedicated Weeb chapter IDs retain their legacy local integers; new generic public IDs retain canonical ownership and must revalidate local bindings after a restore.
3. Run `docker compose --env-file /private/path/reader.env -f services/reader-bridge/compose.yml up -d --build`. The pinned images and existing extension are reused. Keep both published ports on loopback.
4. Verify source lists, manga and manhwa pages, cache reuse and a container restart. Run only one active host registering with the existing key. Switch to a named tunnel/private HTTPS bridge for ongoing use; `READER_BRIDGE_URL` can pin a trusted server endpoint in Sites instead of using temporary registration.

For a fresh installation without the preserved data volume, install the Weeb Central extension through the authenticated local Suwayomi GraphQL `updateExtension` operation. Do not expose the administration API to visitors. Docker and source-extension runtime verification is separate from Yoru's fixture-based CI tests.

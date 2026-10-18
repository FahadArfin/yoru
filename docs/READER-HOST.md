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

Suwayomi's authenticated API binds to `127.0.0.1:4567`; the authenticated bridge binds to `127.0.0.1:4568`. Suwayomi's WebUI is disabled. Only the bridge's fixed manga-reading operations pass through the tunnel; administration, extension installation, arbitrary GraphQL and arbitrary URL fetching are unavailable publicly.

## Sources and caching

- MangaDex uses its official API, credited chapter editions and its image service through the bridge.
- Weeb Central uses the installed Suwayomi extension `eu.kanade.tachiyomi.extension.en.weebcentral` from the configured Keiyoushi store. The current installation was verified with version 1.6.25. Extensions are third-party code; review updates before installing them. Automatic extension updates and challenge-solving services are disabled.
- MALSync supplies exact MAL-to-source links. Matching also checks the source's returned URL and manga ID. Similar names alone are insufficient. Chapter ownership is checked again before images or chapter activity writes.
- Official publisher redirects stay external. The reader does not retrieve their pages, bypass payment, or defeat access challenges. An extension's availability is not a grant of redistribution permission; source terms and removals still apply.

The three persistent volumes are:

| Volume                       | Contents                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `yoru-reader_suwayomi-data`  | Suwayomi database, installed extension and stable chapter identities                   |
| `yoru-reader_suwayomi-cache` | Suwayomi's temporary page cache; 1 GiB target, 72-hour expiry                          |
| `yoru-reader_bridge-data`    | Verified mappings and manifests, plus a separate 1 GiB image cache with 72-hour expiry |

Images are fetched only when requested by a reader. No whole-catalog download or chapter pre-download job runs. Cleanup runs on cache writes and every 15 minutes while the host is running, including after startup. Metadata and database size are separate from the approximately 2 GiB image budget. Browser image caching lasts five minutes. Cached images do not guarantee offline reading: the current source identity and page manifest must still be valid. Source removals are rechecked as the short metadata/page-list caches expire. To immediately retire a source, stop the bridge, remove its selection in the adapter, and clear the dedicated caches before restarting; preserve `suwayomi-data` unless intentionally resetting all source identities.

## Temporary public connection

The bridge uses a [Cloudflare Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/). Its random HTTPS address registers with Yoru every 45 seconds using the shared secret. Sites forgets the address after three minutes without renewal. A recreated tunnel registers its replacement automatically, so a PC or container restart does not require a new frontend publication. The cloudflared image supplies its trusted CA bundle; TLS validation remains enabled.

Quick Tunnels are intended for testing, have no uptime guarantee and a 200 in-flight-request limit. This is the temporary PC pilot requested by the owner. Move to a named tunnel or a secured HTTPS endpoint for the permanent server. The bridge permits 12 concurrent operations; transient failures show a retry/source choice rather than a fabricated chapter list.

## Move to the personal server

1. Stop this Compose project before taking a consistent backup of its three named volumes. Keep the private environment file with that backup using secure storage.
2. Install Docker on the server, check out the same Yoru revision, and restore the volumes with the same names and UID/GID 1000 ownership. Keeping `suwayomi-data` is essential: native chapter links include Suwayomi's database IDs.
3. Run `docker compose --env-file /private/path/reader.env -f services/reader-bridge/compose.yml up -d --build`. The pinned images and existing extension are reused. Keep both published ports on loopback.
4. Verify source lists, manga and manhwa pages, cache reuse and a container restart. Run only one active host registering with the existing key. Switch to a named tunnel/private HTTPS bridge for ongoing use; `READER_BRIDGE_URL` can pin a trusted server endpoint in Sites instead of using temporary registration.

For a fresh installation without the preserved data volume, install the Weeb Central extension through the authenticated local Suwayomi GraphQL `updateExtension` operation. Do not expose the administration API to visitors. Docker and source-extension runtime verification is separate from Yoru's fixture-based CI tests.

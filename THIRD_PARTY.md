# Third-party software and services

Checked 2026-10-09 from the build sandbox. "Verified" means read from the installed
package (`node_modules/*/package.json` and `LICENSE*`). Web pages that the sandbox's network
proxy blocked are marked "not verified, unreachable from build sandbox"; nothing below was
filled in from memory for those, except where flagged as "from memory (unverified)".

## Libraries

### Shipped in the built site

| Library | Version | Licence | How verified |
|---|---|---|---|
| Leaflet | 1.9.4 | BSD-2-Clause | `node_modules/leaflet/LICENSE` and package.json (verified) |
| PapaParse | 5.5.3 | MIT | `node_modules/papaparse/LICENSE` and package.json (verified) |
| SheetJS Community Edition (`xlsx`) | 0.20.3 (pinned) | Apache-2.0 | see below |

SheetJS: the npm registry copy (0.18.5) is old; SheetJS publishes current builds from its own
CDN and documents both `npm i --save https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` and
vendoring the tarball into the project. This repo **vendors** it:

- `vendor/xlsx-0.20.3.tgz` was downloaded from
  `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` by a one-off GitHub Actions job on
  2026-10-09 (the build sandbox cannot reach cdn.sheetjs.com).
  SHA-256 `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`.
- `package.json` pins `"xlsx": "file:vendor/xlsx-0.20.3.tgz"`; `package-lock.json` records its
  sha512 integrity, so `npm ci` needs no access to the CDN.
- Licence verified 2026-10-09 from the tarball itself: `package.json` says `"license": "Apache-2.0"`
  and the bundled `LICENSE` is the Apache License 2.0 text.
- The app uses only `read`, `write` and `utils`.

### Development and test only (not shipped)

| Package | Version | Licence (verified from package.json and LICENSE) |
|---|---|---|
| vite | 8.3.4 | MIT |
| vitest | 5.0.3 | MIT |
| typescript | 5.8.3 | Apache-2.0 |
| @playwright/test | 1.56.0 | Apache-2.0 |
| jsdom | 26.1.0 | MIT |
| @types/leaflet | 1.9.18 | MIT |
| @types/papaparse | 5.3.16 | MIT |

Transitive dependencies of these dev tools were not individually audited. Run
`npx license-checker --production` (or similar) before release if a full audit is wanted.
All direct dependencies are permissive (MIT / BSD / Apache-2.0); no GPL/AGPL code is used.

## Service usage terms

None of the policy pages below could be fetched from the build sandbox (the egress proxy blocked
`operations.osmfoundation.org`, `wiki.openstreetmap.org`, `osmfoundation.org` and
`docs.github.com`). The summaries are therefore **from memory (unverified)** and must be
re-checked by a person with open internet access before release. Date of the attempted check:
2026-10-09.

### OSM tile usage policy (operations.osmfoundation.org/policies/tiles/)
Status: not verified, unreachable from build sandbox.
From memory (unverified): tile.openstreetmap.org is a community resource with no service
guarantee; heavy use, bulk downloading and prefetching are prohibited; a valid identifying
Referer or User-Agent is required; HTTP caching headers must be honoured; attribution
"© OpenStreetMap contributors" must be visible; the URL may change, so it must be configurable.
How the app complies: tile URL is a user setting; attribution is shown whenever OSM tiles are
on; the browser sends its normal Referer (the Pages site URL) because the browser cannot set a
User-Agent; Leaflet loads only visible tiles with no prefetching; browser HTTP cache is not
bypassed; a "no basemap" option draws jobs on a blank background and sends no tile requests.
Tile requests reveal the viewed area only, never individual job positions (brief 2.1a).

### Nominatim usage policy (operations.osmfoundation.org/policies/nominatim/)
Status: not verified, unreachable from build sandbox.
From memory (unverified): maximum 1 request per second; identifying User-Agent or Referer;
no autocomplete-as-you-type; results should be cached; attribution required; no bulk geocoding.
How the app complies: geocoding runs only when the user presses Search (no autocomplete), through
a limiter of at most 1 request per second (`src/net/ratelimit.ts`); the browser Referer
identifies the site; the matched place name is shown for confirmation; only the typed address is
sent. Results from the base lookup are cached in browser storage.

### Overpass API (wiki.openstreetmap.org/wiki/Overpass_API, overpass-api.de)
Status: not verified, unreachable from build sandbox.
From memory (unverified): the public instances are shared, with per-IP slot and rate limits and
a fair-use expectation (small queries, no heavy automated load); responses under load can be
429/504.
How the app complies: exactly one small request per routing session, carrying only the averaged
centroid (one coordinate pair); result cached keyed by the centroid rounded to 2 dp; failure or
offline falls back to the centroid as base with a visible note; requests are rate limited.

### OSRM public demo server (router.project-osrm.org)

Offered as a one-tap choice in the "Use road network" dialog; never used unless the user
switches Distances to Road network and ticks the confirmation box. The usage policy page was
not verified (unreachable from build sandbox). From memory (unverified): it is a demo service
for light, non-heavy use, limited to about one request per second, car profile only, with no
uptime guarantee. The app sends at most one table request per second to it and identifies
itself by Referer. Re-check the current terms before relying on it.

### ODbL and OSM attribution
Status: not verified, unreachable from build sandbox (osmfoundation.org Licence/Attribution_Guidelines).
From memory (unverified): OSM data and tiles are under the ODbL; reuse needs the credit
"© OpenStreetMap contributors" with a link to the copyright page (openstreetmap.org/copyright),
visible on the map. Town names from Overpass are OSM data; the app shows the attribution on the
map when OSM tiles are on and in the About panel.

### GitHub Pages availability
Status: not verified against docs.github.com (unreachable from build sandbox). A web search on
2026-10-09 returned only GitHub Enterprise Server documentation, which says Pages is available for
public repositories on the Free plan and for private repositories on paid plans (Pro, Team,
Enterprise); the github.com page itself was not read. Conclusion for this project: keep the
repository public, and confirm on docs.github.com before relying on it. The deploy workflow
needs Pages enabled with source "GitHub Actions" in the repository settings.

## GitHub Actions used (checked 2026-10-09 via the GitHub releases pages, which were reachable)

| Action | Latest release seen | Pinned as |
|---|---|---|
| actions/checkout | v7.0.1 | v7 |
| actions/setup-node | v7.1.0 | v7 |
| actions/upload-artifact | v7.0.2 | v7 |
| actions/configure-pages | v6.0.0 | v6 |
| actions/upload-pages-artifact | v5.0.0 | v5 |
| actions/deploy-pages | v5.0.1 | v5 |

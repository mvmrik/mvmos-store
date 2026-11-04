# Circuit coordinate sources

The new official circuits use Tomislav Bacinger's `f1-circuits` geographic outlines and location points, from revision `8094e957b8d6aa8b9f4510c93968556cccd30e02`:

https://github.com/bacinger/f1-circuits/tree/8094e957b8d6aa8b9f4510c93968556cccd30e02

The source snapshots are `f1-circuits.geojson` and `f1-locations.json`. The copyright and MIT permission notice are retained in `f1-circuits-LICENSE.md`. Source geometry is unofficial and can represent a particular layout revision, rather than the latest race configuration.

`../tools/build-circuits.py` projects geographic coordinates into local metre coordinates, corrects winding to the driving direction, smooths and resamples each closed center line, and measures reference laps and the race speed profile through the game's existing `track_ref.mjs` and `public/sim.js`. This process requires Python and Node, with no network dependency. It writes the catalog only if every circuit produces a clean reference lap. Zandvoort is preserved unchanged, including its existing reference times and records.

Widths, run-off, the three timing sectors and generated pit lanes are gameplay approximations. The simulation remains planar: the Suzuka crossing follows the two independent portions of its figure-eight route without a modeled bridge or altitude change. Buildings, banking, tunnels and track-specific scenery are not recreated. These circuits are playable adaptations, not surveyed or laser-scanned reproductions. Monaco uses its 78-lap race distance; the other new circuits use the minimum whole lap count covering 305 km from the source's published length.

The existing Zandvoort adaptation retains its source attribution to the TUMFTM racetrack database (LGPL-3.0) and OpenStreetMap contributors (ODbL), as recorded in its catalog entry:

https://github.com/TUMFTM/racetrack-database

Monaco race distance reference: https://www.formula1.com/en/racing/2025/monaco

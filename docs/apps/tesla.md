# Tesla

Tesla 1.0.0 records vehicle status and history on your own mvmOS installation. It provides a desktop window and an Apps Hub page at `/pub/tesla/`. Core 1.17.0 is required for profile-specific visibility and the shared regional date/time picker.

## Connect your vehicle

Install the app with its approved server component. On the desktop, open the app settings as root and select the Apps Hub profile that will own the connection. Configure the installation's public HTTPS origin. Setup creates a stable server key and exposes only its public half at `/.well-known/appspecific/com.tesla.3p.public-key.pem` for the configured host. If needed, setup installs the cryptography Python package automatically.

Use your own Tesla developer application credentials, choose its region, and configure the callback shown by the app. Save credentials, register the public domain/key and complete the Tesla account connection. Registration checks that the public key is reachable and matches Tesla's registered key. Keep the domain and key stable. Disconnect before changing connected credentials or the registered installation origin.

Tesla Fleet API access and any Tesla usage charges are separate from mvmOS. The request budget and cost display are local estimates, not a billing statement. Recorded history starts when collection is configured; it does not import past journeys from Tesla.

## Status and history

Select a connected vehicle to inspect available battery, range, climate and sensor readings. Trips include collected route points, distance, duration and estimated efficiency. Charging history includes energy, locations and costs. Named places can supply AC/DC prices; tariff rules and manual session totals refine cost reporting. Different currencies remain separate. Splits between tariff periods are estimates when exact boundary readings are unavailable.

Group recorded trips into journeys to inspect combined travel. The app also shows battery health estimates and recorded sleep history. These depend on the samples available and are not diagnostic measurements.

## Route replay

Trip details and saved journeys have a map playback control with play/pause, a seek slider and 0.5×, 1×, 2× and 4× rates. At 1×, each pair of consecutive recorded readings takes one second to play, regardless of whether the real interval was five minutes or thirty minutes. The displayed timeline follows the original timestamps, so longer waits pass more quickly.

The car marker interpolates between stored GPS points. It does not reconstruct the exact road between sparse recordings. During charging, the power display uses the recorded charger power; during other states it uses battery power. Speed, power, battery and state show the last stored reading, not interpolated measurements; missing values remain unavailable. The original measurement timestamp is shown separately from the advancing replay clock. Missing GPS positions hide the marker. Replay pauses when the tab is hidden and stops when navigating away. Replay starts in Follow car mode, with the vehicle centred at a closer zoom while the map moves underneath. Whole route restores the route overview. Zoom controls work while following; manually dragging or pinching releases the camera so it does not fight the user. Select Follow car to centre it again. Map pan/zoom remains available during replay.

Playback uses stored samples, including stationary periods. Older records without samples can fall back to original trip points. No Tesla requests or additional API keys are required. Map tiles still load normally.

## Elevation profiles

Automatic trip details and saved journeys include an approximate terrain elevation profile with ascent, descent and minimum/maximum heights. Existing routes work too: the app uses their recorded GPS points, without querying Tesla again. Heights use metres or feet according to the selected units.

No additional API key, account or Python package is required. Opening a profile downloads anonymous one-degree Skadi HGT terrain squares from the public AWS Terrain Tiles dataset and caches them under `apps/tesla/.runtime/elevation/` (approximately 256 MB maximum). Internet access is needed for squares not already cached. These runtime files are excluded from Store archives. Full coordinates are not submitted to an elevation lookup API; the download identifies the required one-degree terrain square.

Heights describe terrain rather than measured vehicle altitude, so tunnels, bridges and sparse GPS recordings can differ. Ascent/descent use a three-metre deadband to reduce small fluctuations. Separate drives, long recording gaps and missing heights are not connected by graph lines. Unavailable or incomplete coverage is reported explicitly, with a retry action. Profiles load separately from the rest of the report.

Data: [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/), with [Tilezen source attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md).

## Collection settings

The minute scheduler checks which vehicles need data. Polling varies while driving, charging, idle, parked or asleep, with configurable intervals and schedules. The app does not send wake-up commands; sleep checks use the vehicle list. Missing connectivity and polling gaps can leave incomplete routes or estimates. Date/time controls follow mvmOS regional settings and reject nonexistent times during daylight saving changes.

## Sharing

The owner can share with selected existing Apps Hub favourites. Viewers can read vehicle status and history but cannot edit data, change polling or trigger manual refresh. Shared administrators can manage the owner's history and settings. They cannot read credentials, reconnect or disconnect the account, change its registration or share it further. The owner retains those actions.

Only the owner and currently shared profiles see Tesla in the public catalogue. Anonymous and unrelated visitors do not gain access through a direct page or API URL. Role changes and revocation are checked against current grants. Sharing does not copy credentials or vehicle records to another profile.

## Storage and checks

Credentials, tokens and collected history remain in the app's private SQLite database, outside `public/`. The public key is intentionally public; its private half never belongs in the Store source or release archive. Back up app data before uninstalling: uninstalling removes the app folder and its history.

Run `venv/bin/python -m unittest discover -s apps/tesla/tests -v` from the installation for isolated onboarding, sharing and billing tests. They use fictional accounts and temporary databases, without contacting a real vehicle.

## Daily car history

The small play button beside the model on Now opens the car history beneath the vehicle. Choose a date in the calendar, seek between that day's stored readings or press Play to advance from the selected reading. Each recorded interval takes one second; all values change at recorded points. The car updates battery, range, temperatures, doors, lock, tyres, active features and charging cable/details from the snapshot available at that time. Unknown fields remain unavailable. Historical tyre pressures are visible on the car; the current tyre-history dialog is not opened from a replay.

History initially selects the latest day with stored samples. The calendar follows mvmOS regional settings; day boundaries and timestamps use the configured timezone, including daylight saving changes (browser-local fallback when the shared picker is unavailable). Empty days show an explicit message. Back to now restores the current view. Playback pauses when the page is hidden and ends on navigation. Current-day summaries and the current-position map are hidden while reviewing history so they cannot be confused with a past reading. No new Tesla requests are made by history or playback. Historical detail depends on what was recorded; older samples without a full raw snapshot can only show their saved basic fields.

Daily replay resolves the status from the recorded state log, rather than the initial `online` value saved before driving/charging classification. List-only sleep and offline transitions appear on the slider too, using the last preceding snapshot while retaining its original measurement timestamp in the data; no later reading is used for an earlier event. If older data has no state log, driving and charging are classified from the recorded shift, speed and charging state. Charging details use the session start and AC/DC type plus energy and electrical measurements available at the selected time, without borrowing the final session totals.

On narrow screens, daily replay fits the car height to the available app area so the calendar, play/pause button and seek slider remain together beneath it. Battery readings use a compact side rail, the return-to-now action becomes an accessible arrow button, and the explanatory note is expandable with the information icon. The layout responds to window resizing and keeps its height steady between playback frames.

The Now car illustration shows open doors, windows and the charge port directly, without duplicate text badges beneath it. Opening and closing these parts during daily replay does not add layout rows or change the car size.

The line beneath the daily replay slider displays the position of the selected recording instead of repeating its date and time. It uses a saved place name or an existing trip/charging address within 100 metres, otherwise GPS coordinates; missing coordinates are reported explicitly. Long names stay on one line with the complete text in a tooltip, so position changes do not resize the car. Position labels are resolved locally, without extra Tesla or geocoding requests. During list-only sleep/offline transitions the position remains the last recorded one.


## Seasonal charging tariffs

A tariff record has a place, charging type, billing time zone and validity dates for price history. Its bands also have annual seasons, weekdays and hours. Separate summer (1 April–31 October) and winter (1 November–31 March) records may share validity dates: only actual overlapping coverage is rejected. The list shows each band's annual dates beside its hours and price.

Annual seasons include both end dates and follow the current local calendar date, including the early hours after midnight. The weekday of an overnight band follows the day it starts. The billing time zone handles skipped and repeated clock hours. The matching record is selected across all applicable seasonal records; an out-of-season record does not hide another valid record.

The single-rate and day/night buttons are explicitly labelled band templates. They replace the bands below with editable starting values, rather than selecting a separate pricing mode. Enter the provider's actual prices, hours, weekdays and seasons; add further bands as needed. Historical price changes still use separate validity periods.


Tariff validity and each band's annual season use the shared mvmOS range calendar. Open one field, choose its start and end, and apply. The season calendar omits the year and supports November–March directly; its display follows the profile or desktop date format, including day before month for a Bulgarian DD/MM/YYYY preference. Existing records keep their stored dates; saving still sends the same validity timestamps and annual month/day values to the tariff API.

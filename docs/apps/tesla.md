# Tesla

Tesla 1.0.0 records vehicle status and history on your own mvmOS installation. It provides a desktop window and an Apps Hub page at `/pub/tesla/`. Core 1.17.0 is required for profile-specific visibility and the shared regional date/time picker.

## Connect your vehicle

Install the app with its approved server component. On the desktop, open the app settings as root and select the Apps Hub profile that will own the connection. Configure the installation's public HTTPS origin. Setup creates a stable server key and exposes only its public half at `/.well-known/appspecific/com.tesla.3p.public-key.pem` for the configured host. If needed, setup installs the cryptography Python package automatically.

Use your own Tesla developer application credentials, choose its region, and configure the callback shown by the app. Save credentials, register the public domain/key and complete the Tesla account connection. Registration checks that the public key is reachable and matches Tesla's registered key. Keep the domain and key stable. Disconnect before changing connected credentials or the registered installation origin.

Tesla Fleet API access and any Tesla usage charges are separate from mvmOS. The request budget and cost display are local estimates, not a billing statement. Recorded history starts when collection is configured; it does not import past journeys from Tesla.

## Status and history

Select a connected vehicle to inspect available battery, range, climate and sensor readings. Trips include collected route points, distance, duration and estimated efficiency. Charging history includes energy, locations and costs. Named places can supply AC/DC prices; tariff rules and manual session totals refine cost reporting. Different currencies remain separate. Splits between tariff periods are estimates when exact boundary readings are unavailable.

Group recorded trips into journeys to inspect combined travel. The app also shows battery health estimates and recorded sleep history. These depend on the samples available and are not diagnostic measurements.

## Collection settings

The minute scheduler checks which vehicles need data. Polling varies while driving, charging, idle, parked or asleep, with configurable intervals and schedules. The app does not send wake-up commands; sleep checks use the vehicle list. Missing connectivity and polling gaps can leave incomplete routes or estimates. Date/time controls follow mvmOS regional settings and reject nonexistent times during daylight saving changes.

## Sharing

The owner can share with selected existing Apps Hub favourites. Viewers can read vehicle status and history but cannot edit data, change polling or trigger manual refresh. Shared administrators can manage the owner's history and settings. They cannot read credentials, reconnect or disconnect the account, change its registration or share it further. The owner retains those actions.

Only the owner and currently shared profiles see Tesla in the public catalogue. Anonymous and unrelated visitors do not gain access through a direct page or API URL. Role changes and revocation are checked against current grants. Sharing does not copy credentials or vehicle records to another profile.

## Storage and checks

Credentials, tokens and collected history remain in the app's private SQLite database, outside `public/`. The public key is intentionally public; its private half never belongs in the Store source or release archive. Back up app data before uninstalling: uninstalling removes the app folder and its history.

Run `venv/bin/python -m unittest discover -s apps/tesla/tests -v` from the installation for isolated onboarding, sharing and billing tests. They use fictional accounts and temporary databases, without contacting a real vehicle.

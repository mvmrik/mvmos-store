# Classifieds

A standalone mvmOS store app. All source and runtime data live in `apps/classifieds`; no core changes or privileged backend are required.

## Setup

Open Classifieds on the desktop with an Apps Hub account. In Settings, create categories and one level of subcategories, choose a validity period (30 days initially), and choose the default currency. An empty default currency follows Regional Settings through Platform API. The supported currency catalog matches the 19 choices in Regional Settings; core does not currently export that catalog through Platform API.

Enable the public page in Apps Hub to expose `/pub/classifieds/`. Anyone can browse active listings. Publishing, managing listings, and personal messages require an Apps Hub account. Desktop settings require the normal desktop session; an Apps Hub token alone cannot administer the app.

## Listings

Listings have a title, description, category, price, currency, optional location and optional public contact. Zero price means free. Each listing supports ten JPEG, PNG or WebP photos of up to 5 MB each. Photos live outside the public asset directory and are served through an access-checked route.

Newest listings appear first. Bumping moves a listing to the top at most once every rolling 24 hours, starting at publication. Editing and toggling active state do not change its position. Bumping does not extend validity. Expired listings are excluded from public queries immediately, without a cron job. Owners can reactivate expired listings for the configured validity period. Existing unexpired listings keep their original deadline; changes to settings do not retroactively change prices or expiry dates.

Each author may override the default currency when creating or editing a listing. Numeric price filters compare only one currency. When a range is entered while all currencies are selected, the interface selects and displays the app's effective default currency. No exchange-rate conversion is performed.

## VIP listings (Premium)

All of this lives in `apps/classifieds/premium/` and simply does not exist without it: an installation without Classifieds' premium content has no VIP packages, no way to buy one, and the listings table's `vip_until` column just stays at its default. Even where the module is present, every action it offers also requires this installation's own core Premium (Apps Hub credits) — a package an admin configured while premium stops working the moment the licence lapses, without anyone touching or deleting it.

In desktop Settings, the admin defines any number of VIP packages, each with a name, a period in days and a price in Apps Hub credits (e.g. a 7-day "Weekly VIP" for 5 credits). The control is always visible there, per the store premium convention; without an active licence it opens the shared Premium modal instead of the package form, and the server refuses the save either way. When posting or editing a listing, an author may optionally pick one of the currently active packages and pay for it in credits, provided the balance covers it — the public page never mentions Premium by name, it simply offers packages when there are any to offer and stays silent otherwise. Buying VIP again before the current period ends extends it rather than restarting the clock. A VIP listing shows a badge and sorts ahead of everything else, both in the overall feed and inside its own category, for as long as `vip_until` is in the future — untouched by whether the installation is still Premium, since the credits were already spent.

## Views and watching

A view is counted at most once per viewer per listing per day — a fixed row in `listing_views` keyed on (listing, viewer, day) is what makes a refresh or a bot loop harmless rather than something to rate-limit. The owner's own visits are never counted. View counts and watcher counts are the owner's own stats: nobody else sees them, on a listing card or anywhere else.

Any signed-in visitor other than the owner can watch a listing from its card or detail view; a listing cannot watch itself. A "Watched" tab lists everything the current account watches, expired ones included, so unwatching is always available even after a listing lapses. The owner sees, for each of their own listings, how many people are watching it and — only for their own listings — exactly who: enough to start a conversation with a specific watcher first, the way a seller might offer someone who's been eyeing an item a discount, without waiting for that person to reach out.

## Personal messages

Visitors can start a private conversation with a seller from a listing, and a seller can just as well start one with a specific watcher first. Conversations are unique per listing and interested account regardless of who opened it. Only the buyer and seller may read, reply, or mark messages read. Deleting a listing retains the conversation and its original title. Messages are plain text, limited to 4,000 characters, with a limit of 30 messages per sender per minute. Client request ids prevent duplicate sends on retry. The interface refreshes unread counts and open conversations every ten seconds while visible. Older messages and conversations are paginated.

## Storage and packaging

`data.db` stores app settings, categories, listings, photo metadata, conversations, messages, and (when premium is installed) VIP packages — `premium/backend.py` reads and writes the same file rather than keeping one of its own. `uploads/` stores runtime photos. Exclude both from source commits and release archives. Premium code lives entirely in `premium/`, published separately from the public app archive — see [CLAUDE.md](../../CLAUDE.md) for the release scripts. Public and desktop interfaces share `public/widget.js`, `public/style.css`, and the nine-language `public/i18n.js`.

The app exports `router` and `desktop_router` from `api.py`, loaded by the standard public loader. Settings use `/api/apps/classifieds`; app data and messages use `/pub/classifieds`. Use the repository's standard store release procedure when preparing a release.

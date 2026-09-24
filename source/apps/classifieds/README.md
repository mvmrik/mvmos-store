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

## User verification (Premium)

Also part of `premium/` and just as absent without it. In desktop Settings the admin defines any number of verifications, each with a name, instructions for the photo the user has to send (for example a sheet of paper with a given word and today's date), a trigger and optionally the categories it covers. The trigger is one of: right after registration, once the account is a given number of days old, or once the user already has a given number of listings (counted inside the covered categories when there are any). A parent category also covers its subcategories; no categories means every category.

A verification never interrupts anyone: users keep browsing, messaging and managing their existing listings. It only stops a new listing, or moving an existing one, into a covered category. The listing editor then shows the instructions and a photo field for the requirements that block that category, and the server refuses the listing with `verification_required` until they are met — the same applies to `add_listing` through the app API. Sending a new photo replaces a pending one.

Every admin who saved a verification is notified of each submission. Approving marks the user verified for that verification and deletes the photo; rejecting just deletes it. Verified users can be listed and revoked per verification. Photos are kept in `storage/verification/` only while pending and are served to the desktop only. Each verification has a `method` column, currently always `photo`, so other methods such as an email or phone code can be added later. Without an active licence nothing is enforced and the public page never mentions verification.

## Moderation

The desktop window has a Moderation panel next to Settings, free and without Premium. Its Listings tab shows every listing whoever owns it, active, expired, deactivated or VIP, searchable by text or id and filterable by category, status and owner. The administrator can edit any listing, including moving it to another category (without the owner's verification), remove its photos, activate or deactivate it, end its VIP period and delete it, one at a time or for a whole selection at once.

The Users tab lists everyone Classifieds knows: sellers, people in conversations and banned profiles, with their listing counts. A ban concerns Classifieds only. It deletes all of that person's listings and their photos and stops them from posting again (including through the app API, which gets `banned`), while their Apps Hub profile stays untouched and they can still browse and message. The public page shows them a notice with the optional reason, and any attempt to publish is refused with the same message. Lifting the ban lets them post again; the deleted listings do not come back. Private messages stay private: moderation gives no inbox access.

Whenever the administrator changes something of a person's, that person gets a system message in their Classifieds Messages: a ban (with the reason, if one was given), lifting it, an edit, a deletion, a move to another category, deactivating or activating a listing, ending its VIP period and removing a photo. All of these arrive in one conversation from the Classifieds administration, marked as a system message and shown in the reader's own language; it cannot be replied to. Actions that change nothing, such as saving an unchanged listing or deactivating one that is already hidden, send no message.

## Views and watching

A view is counted at most once per viewer per listing per day — a fixed row in `listing_views` keyed on (listing, viewer, day) is what makes a refresh or a bot loop harmless rather than something to rate-limit. The owner's own visits are never counted. View counts and watcher counts are the owner's own stats: nobody else sees them, on a listing card or anywhere else.

Any signed-in visitor other than the owner can watch a listing from its card or detail view; a listing cannot watch itself. A "Watched" tab lists everything the current account watches, expired ones included, so unwatching is always available even after a listing lapses. The owner sees, for each of their own listings, how many people are watching it and — only for their own listings — exactly who: enough to start a conversation with a specific watcher first, the way a seller might offer someone who's been eyeing an item a discount, without waiting for that person to reach out.

## Personal messages

Visitors can start a private conversation with a seller from a listing, and a seller can just as well start one with a specific watcher first. Conversations are unique per listing and interested account regardless of who opened it. Only the buyer and seller may read, reply, or mark messages read. Deleting a listing retains the conversation and its original title. Messages are plain text, limited to 4,000 characters, with a limit of 30 messages per sender per minute. Client request ids prevent duplicate sends on retry. The interface refreshes unread counts and open conversations every ten seconds while visible. Older messages and conversations are paginated.

## Storage and packaging

`data.db` stores app settings, categories, listings, photo metadata, conversations, messages, banned profiles, and (when premium is installed) VIP packages and verifications — `premium/backend.py` reads and writes the same file rather than keeping one of its own. `uploads/` stores runtime photos and `storage/verification/` pending verification photos. Exclude both from source commits and release archives. Premium code lives entirely in `premium/`, published separately from the public app archive — see [CLAUDE.md](../../CLAUDE.md) for the release scripts. Public and desktop interfaces share `public/widget.js`, `public/style.css`, and the nine-language `public/i18n.js`.

The app exports `router` and `desktop_router` from `api.py`, loaded by the standard public loader. Settings use `/api/apps/classifieds`; app data and messages use `/pub/classifieds`. Use the repository's standard store release procedure when preparing a release.

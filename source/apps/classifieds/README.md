# Classifieds

A standalone mvmOS store app. All source and runtime data live in `apps/classifieds`; no core changes or privileged backend are required.

## Setup

Open Classifieds on the desktop with an Apps Hub account. In Settings, create categories and one level of subcategories, choose a validity period (30 days initially), and choose the default currency. An empty default currency follows Regional Settings through Platform API. The supported currency catalog matches the 19 choices in Regional Settings; core does not currently export that catalog through Platform API.

Enable the public page in Apps Hub to expose `/pub/classifieds/`. Anyone can browse active listings. Publishing, managing listings, and personal messages require an Apps Hub account. Desktop settings require the normal desktop session; an Apps Hub token alone cannot administer the app.

## Listings

Listings have a title, description, category, price, currency, optional location and optional public contact. Zero price means free. Each listing supports ten JPEG, PNG or WebP photos of up to 5 MB each. Photos live outside the public asset directory and are served through an access-checked route.

Newest listings appear first. Bumping moves a listing to the top at most once every rolling 24 hours, starting at publication. Editing and toggling active state do not change its position. Bumping does not extend validity. Expired listings are excluded from public queries immediately, without a cron job. Owners can reactivate expired listings for the configured validity period. Existing unexpired listings keep their original deadline; changes to settings do not retroactively change prices or expiry dates.

Each author may override the default currency when creating or editing a listing. Numeric price filters compare only one currency. When a range is entered while all currencies are selected, the interface selects and displays the app's effective default currency. No exchange-rate conversion is performed.

## Personal messages

Visitors can start a private conversation with a seller from a listing. Conversations are unique per listing and interested account. Only the buyer and seller may read, reply, or mark messages read. Deleting a listing retains the conversation and its original title. Messages are plain text, limited to 4,000 characters, with a limit of 30 messages per sender per minute. Client request ids prevent duplicate sends on retry. The interface refreshes unread counts and open conversations every ten seconds while visible. Older messages and conversations are paginated.

## Storage and packaging

`data.db` stores app settings, categories, listings, photo metadata, conversations and messages. `uploads/` stores runtime photos. Exclude both from source commits and release archives. There is no premium code in this version. Public and desktop interfaces share `public/widget.js`, `public/style.css`, and the nine-language `public/i18n.js`.

The app exports `router` and `desktop_router` from `api.py`, loaded by the standard public loader. Settings use `/api/apps/classifieds`; app data and messages use `/pub/classifieds`. Use the repository's standard store release procedure when preparing a release.

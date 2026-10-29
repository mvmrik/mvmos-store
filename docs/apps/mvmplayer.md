# mvmPlayer

mvmPlayer is a general browser video player and shared library for the mvmOS desktop and Apps Hub. It is separate from **mvmVideo**, the video editor. The initial version runs entirely inside `apps/mvmplayer/`; it has no system backend component, FFmpeg dependency or separate service.

## Add videos

Open mvmPlayer on the desktop and choose **Manage → Upload videos**. Select multiple video files, or select a folder to preserve the names used for recognition. Uploading happens before editing metadata. Review the saved records afterwards; an invalid file does not discard the successful uploads. Uploads use retry-safe chunks of up to 8 MiB, automatically reduced when a proxy rejects that size. The current limits are 200 videos per batch and 32 GiB per file. Cancelling keeps completed videos. Incomplete uploads expire after 24 hours and are cleaned when another upload starts.

Only desktop administrators upload, edit and delete shared media in this first version. Apps Hub profiles can watch, maintain their own progress, favourites, history and collections, and load a subtitle file locally. Personal server uploads and Jellyfin integration are not part of this version.

Recognised examples:

- `Series.Name/Season 02/Series.Name.S02E05.The.Arrival.mp4`
- `Series Name/Season 02/05 - The Arrival.webm`
- `Movie.Name.2024.mp4`

Names without a year or episode pattern start as general videos; change the type in **Edit** if needed. A bare `S02E05` cannot identify the series without a useful parent folder or a manually supplied series name. Classification is an editable guess, not file-content identification.

## Playback and personal progress

Open a card to inspect the description and progress, then choose **Play** or **Resume**. Opening details alone never starts video. Native browser controls provide seeking, volume and playback; extra controls add speed, 10-second jumps, fullscreen, picture in picture where supported, and optional automatic playback of the next available episode. Missing episodes are not downloaded. Next episode follows uploaded season/episode order, so it can skip unavailable episodes.

Progress is independent for each Apps Hub profile. It is saved periodically during playback, on pauses and seeks, and when leaving the page or closing the player. Network/session failures are reported. Completion is recorded when playback ends or the viewer explicitly marks the item as watched. Marking an item unwatched preserves its saved position. Renaming, changing an online match or replacing a cover does not replace the media identifier or reset progress.

Personal collections contain existing library items and do not copy video files. Collections are private to the profile in this version. Desktop **Manage** uses the same library cards as editing entry points.

## Formats and subtitles

This version **does not transcode or remux**. Container recognition accepts MP4/M4V/MOV, WebM, MKV, OGV and AVI uploads, but that does not guarantee playback. Actual playback depends on the browser, operating system and video/audio codecs. MP4 with H.264/AAC and compatible WebM are good starting points. MKV, HEVC and uncommon audio tracks may fail. The player reports playback failure rather than claiming universal format support.

External SRT and WebVTT subtitles are supported:

- Administrators add shared subtitles from a video's editing screen, with a title and language. These are converted to a safe text-only WebVTT subset and stored with the record.
- A viewer may choose **Open subtitle file** in the player. That file stays on their device, is not uploaded, and applies only to the current playback.
- UTF-8, BOM-marked UTF-16 and Windows-1251 subtitle input are supported. Formatting markup is removed.
- Embedded subtitle extraction, ASS styling and bitmap subtitles are not supported in this version.

## Optional online details

Online searches are explicit administrator actions from **Edit → Find online details**. There is no central mvmOS metadata relay or user API key. Requests originate from the installation, use bounded requests to fixed provider hosts, are paced, and are cached locally.

- **Series:** TVmaze search supplies show descriptions, genres, years, artwork when available and a known season/episode list. Every search result is checked against the uploaded file’s exact season and episode number. Matching results appear first and show the episode title and air date, alongside the series premiere, network, country and language when available. Missing episodes and temporary verification failures have distinct labels. Choose episode title/description separately from series-wide details. When applying to all uploaded episodes, each matched episode receives its own title and synopsis; unmatched episodes retain those fields. A candidate verified for one season/episode cannot be applied as episode data to another. Apply the chosen series match to one or all uploaded episodes of the same series. The series view then distinguishes uploaded episodes from catalogue episodes without local files. TVmaze data is attributed and licensed under CC BY-SA; its catalogue may be incomplete or use a different episode order.
- **Movies and other subjects:** Wikipedia article search in the selected interface language supplies optional titles, introductory descriptions and images. This is not a dedicated film metadata service: unrelated subjects may appear, images/year data may be absent, and results require review. It does not guarantee a theatrical poster. Source links remain visible after applying a match.

Choose which fields to replace. Existing values remain selectable so another match can replace an earlier one. Series metadata never overwrites episode numbers or resets watched state. Episode titles and descriptions are updated only when their separate fields are selected; a bulk update resolves each episode independently. Provider failure does not remove uploaded videos; manual editing remains available.

## Storage and access

Videos live under `apps/mvmplayer/uploads/`, outside the public folder. SQLite stores metadata, covers, shared subtitles, collections and per-profile state. Streaming uses a random short-lived playback ticket rather than placing the Apps Hub login token in a video URL. Every request rechecks the associated profile session. Byte-range requests support seeking. Cover and subtitle requests require authentication.

Deleting a video removes its file, stored cover, shared subtitles, playback tickets, collection references and all profiles' state for that video. A confirmation explains the scope. There is no automatic deletion based on watching progress.

Cloudflare Tunnel does not change browser codec support, and video delivery through a public tunnel remains subject to Cloudflare's service conditions.

## Validation

`tests/test_api.py` builds isolated temporary libraries with fictional users. `venv/bin/python apps/mvmplayer/tests/test_api.py --serve` starts an isolated fixture server on `127.0.0.1:2088`. Run `tests/browser.cjs` against it, setting `MVM_PLAYER_PLAYWRIGHT` to an existing Playwright Core installation if needed. The browser test exercises: desktop and phone layouts, playback/resume, subtitles, independent progress, metadata replacement, series structure, collections, a 20-file import plus an invalid file, proxy chunk rejection, lost finish responses, automatic next episode, and profile-language selection. The synthetic video fixture is bundled; running the application or tests does not invoke FFmpeg or install packages.

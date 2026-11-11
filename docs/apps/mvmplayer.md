# mvmPlayer

mvmPlayer is a general browser video player and shared library for the mvmOS desktop and Apps Hub. It is separate from **mvmVideo**, the video editor. The app runs entirely inside `apps/mvmplayer/`; it has no system backend component, FFmpeg dependency or separate service.

## Add videos

Open **Library** on the desktop and add a folder on this server or a connected folder shared by another mvmOS. Videos stay in place. Scan manually or select a scan interval; filename recognition adds movie years, series, seasons and episodes. The source manager can upload files or folders into that location through the shared uploader. Removing a source removes its records, never its original files. Scans remove records for videos no longer present in the source, including their associated viewing state.

Server files are read with the access of the Linux user who added the source. Shared videos play directly from the sharing server. Existing uploaded videos remain available. Open a single video from File Manager to play it in the existing window without adding it to the library.

Desktop administrators manage sources and shared metadata. Apps Hub profiles watch and maintain their own progress, favourites, history and collections. Personal video uploads and Jellyfin integration are not included.

Recognised examples:

- `Series.Name/Season 02/Series.Name.S02E05.The.Arrival.mp4`
- `Series Name/Season 02/05 - The Arrival.webm`
- `Movie.Name.2024.mp4`

Names without a year or episode pattern start as general videos; change the type in **Edit** if needed. A bare `S02E05` cannot identify the series without a useful parent folder or a manually supplied series name. Classification is an editable guess, not file-content identification.

## Playback and personal progress

Open a card to inspect the description and progress, then choose **Play** or **Resume**. Opening details alone never starts video. Native browser controls provide seeking, volume and playback; extra controls add speed, 10-second jumps, fullscreen, picture in picture where supported, and optional automatic playback of the next available episode. Missing episodes are not downloaded. Next episode follows uploaded season/episode order, so it can skip unavailable episodes.

Progress is independent for each Apps Hub profile. It is saved periodically during playback, on pauses and seeks, and when leaving the page or closing the player. Network/session failures are reported. Completion is recorded when playback ends or the viewer explicitly marks the item as watched. Marking an item unwatched preserves its saved position. Renaming, changing an online match or replacing a cover does not replace the media identifier or reset progress.

Personal collections contain existing library items and do not copy video files. Collections are private to the profile in this version. Desktop administrators can edit shared metadata from the ordinary detail cards.

## Formats and subtitles

This version **does not transcode or remux**. Container recognition accepts MP4/M4V/MOV, WebM, MKV, OGV and AVI uploads, but that does not guarantee playback. Actual playback depends on the browser, operating system and video/audio codecs. MP4 with H.264/AAC and compatible WebM are good starting points. MKV, HEVC and uncommon audio tracks may fail. The player reports playback failure rather than claiming universal format support.

External SRT and WebVTT subtitles are supported:

- Administrators add shared subtitles from a video's editing screen, with a title and language. These are converted to a safe text-only WebVTT subset and stored with the record.
- A viewer may choose **Open subtitle file** in the player. That file stays on their device, is not uploaded, and applies only to the current playback.
- UTF-8, BOM-marked UTF-16 and Windows-1251 subtitle input are supported. Formatting markup is removed.
- Scans detect SRT/WebVTT files beside videos, such as `Movie.en.srt`. Playback selects an available subtitle matching the viewer’s language.
- Text subtitles stored inside MKV and WebM videos are listed in the subtitle selector when the film opens. Choosing one makes the browser read the file from where it is stored (this server or the sharing server), showing progress, and display the lines as they are found. Nothing passes through the mvmOS server, but the browser reads the whole file once, so use a good connection. Picture subtitles are listed but cannot be shown, and ASS styling is not rendered. MP4 files are not read this way.

## Optional online details

Online searches are explicit administrator actions: the lookup button on a series or a movie, or **Edit → Find online details**. Series information is kept separately from episodes, the series cover is shown on episodes without a picture of their own, and a series you have identified fills in its new episodes after a scan and when the player opens, asking providers only when something is missing. Movies are never filled in automatically. There is no central mvmOS metadata relay or user API key. Requests originate from the installation, use bounded requests to fixed provider hosts, are paced, and are cached locally.

- **Series:** TVmaze search supplies show descriptions, genres, years, artwork when available and a known season/episode list. Every search result is checked against the uploaded file’s exact season and episode number. Matching results appear first and show the episode title and air date, alongside the series premiere, network, country and language when available. Missing episodes and temporary verification failures have distinct labels. Choose episode title/description separately from series-wide details. When applying to all uploaded episodes, each matched episode receives its own title and synopsis; unmatched episodes retain those fields. A candidate verified for one season/episode cannot be applied as episode data to another. Apply the chosen series match to one or all uploaded episodes of the same series. The series view then distinguishes uploaded episodes from catalogue episodes without local files. TVmaze data is attributed and licensed under CC BY-SA; its catalogue may be incomplete or use a different episode order.
- **Movies and other subjects:** Wikipedia article search in the selected interface language supplies optional titles, introductory descriptions and images. This is not a dedicated film metadata service: unrelated subjects may appear, images/year data may be absent, and results require review. It does not guarantee a theatrical poster. Source links remain visible after applying a match.

Choose which fields to replace. Existing values remain selectable so another match can replace an earlier one. Series metadata never overwrites episode numbers or resets watched state. Episode titles and descriptions are updated only when their separate fields are selected; a bulk update resolves each episode independently. Provider failure does not remove uploaded videos; manual editing remains available.

## Storage and access

Existing uploads live under `apps/mvmplayer/uploads/`, outside the public folder. Source videos stay in their configured server or shared folder. SQLite stores metadata, covers, shared subtitles, collections and per-profile state. Streaming uses a random short-lived playback ticket rather than placing the Apps Hub login token in a video URL. Every request rechecks the associated profile session. Byte-range requests support seeking. Cover and subtitle requests require authentication.

Source files are removed only through their folder, not from a video card. Deleting an old uploaded video removes its file, stored cover, shared subtitles, playback tickets, collection references and all profiles' state for that video. A confirmation explains the scope. There is no automatic deletion based on watching progress.

Cloudflare Tunnel does not change browser codec support, and video delivery through a public tunnel remains subject to Cloudflare's service conditions.

## Validation

`tests/test_api.py` builds isolated temporary libraries with fictional users. `venv/bin/python apps/mvmplayer/tests/test_api.py --serve` starts an isolated fixture server on `127.0.0.1:2088`. Run `tests/browser.cjs` against it, setting `MVM_PLAYER_PLAYWRIGHT` to an existing Playwright Core installation if needed. The browser test exercises: desktop and phone layouts, playback/resume, subtitles, independent progress, metadata replacement, series structure, collections, a 20-file import plus an invalid file, proxy chunk rejection, lost finish responses, automatic next episode, and profile-language selection. The synthetic video fixture is bundled; running the application or tests does not invoke FFmpeg or install packages.

## Simkl

Ask the administrator to add a Simkl client ID in Apps Hub → Service keys and allow mvmPlayer and your profile to use it. The form shows the installation origin to register with Simkl. Each profile then connects its own account using Simkl’s device code. The shared client ID is not a personal access token.

Trending titles are available with a shared key. After connecting, browse personal history and planned series, open seasons and episode lists, mark episodes, a season or a series watched or unwatched, and plan an unwatched series. Completed library videos are reported to that profile’s connected account. Ratings and links come from Simkl; unavailable services do not prevent ordinary local playback. A connection belongs to the client ID used to create it; changing the shared key requires reconnecting.

## Optional AI subtitle translation

The administrator enables translation in mvmPlayer settings. It requires Premium, an installed and configured mvmAI, and its App API enabled in Apps Hub → Settings → App APIs (off by default). The desktop keeps the activation control visible without Premium; public pages omit translation while unavailable.

In a video’s subtitle selector choose AI translation. Choose any listed subtitle, a separate file or one stored inside the video, select one of the nine mvmOS languages and review the credit quote. A subtitle stored inside the video is first read by the browser, with progress, and only its text is sent to the server; that text is kept as a subtitle of the video, so it can be played or translated again without reading the file. Text is translated in groups of up to 40 cues while original timings remain unchanged. Jobs show progress and can be cancelled. Failed or cancelled jobs refund their translation charges; completed jobs retain them. Only the requesting profile can inspect or cancel its job.

Completed translations appear in the subtitle selector and are saved as SRT beside the video when permitted. Otherwise the app keeps its own subtitle copy. Picture subtitles are unsupported. Ordinary playback, existing subtitles and the shared library work without translation.

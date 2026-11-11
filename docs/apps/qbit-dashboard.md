# qBit Dashboard

qBit Dashboard connects to the qBittorrent WebUI running on the same server. Configure its host, port and credentials in the app settings, or use the app's setup flow when qBittorrent is missing.

Version 1.8.0 adds case-insensitive torrent name search in the sidebar. Search works together with the selected state filter and existing sort order. A separate empty result message distinguishes no matching torrents from an empty library. Clear the search field to return to the complete filtered list.

Version 1.9.0 chooses folders with the shared mvmOS folder window, which opens in the middle of the screen. When adding a torrent, or moving one from its details, it starts at the save path currently entered or last remembered; the same applies to adding an IPTorrents result. It shows only this server and keeps you inside the signed-in user's own home folder: you can go back up as far as that folder but not into system folders. A saved path outside the home folder, or one that no longer exists, opens the home folder instead. The app needs mvmOS 1.21.0.

Version 1.10.0 redesigns the detail view of a torrent. Its information is grouped in cards, the files list shows a priority selector beside every file, and peers appear in a table. The torrent list uses the space better, and a torrent chosen in the list stays the one whose tabs you open. When adding a torrent from a file, the optional tags are now passed on to qBittorrent.

## Subtitle extraction (Premium)

With a licence, qBit Dashboard can save the text subtitles built into MKV, WebM and MP4 videos next to the video when a torrent finishes, as `Name.<lang>.srt`. The work happens on the server in a pure Python reader, so nothing has to be installed and the film does not have to be downloaded to a browser. Turn it on in the app settings, list the languages in order of preference and choose whether it applies to every new file or only to the ones you choose. The first language that already exists beside the video, or is found as an embedded track, is the only one saved; the next ones are tried only when it is missing.

When adding a torrent you can switch extraction on for it, and each video in the Files list has its own toggle with the result: saved, already there, not found, file missing or could not be read. The per-torrent choice is kept as the qBittorrent tags `mvmos-subs` and `mvmos-nosubs`, which the Info tab hides, and the per-file results are in the app's own database. A background check runs every 30 seconds while the server is up. Without Premium the controls are shown locked on the desktop and nothing is extracted. Image-based subtitles are not converted.

The dashboard retains its torrent controls, file and peer details, traffic statistics and optional IPTorrents search. IPTorrents requires your own session cookies; qBittorrent must expose its WebUI API. This app manages real downloads and files on the server.

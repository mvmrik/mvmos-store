# qBit Dashboard

qBit Dashboard connects to the qBittorrent WebUI running on the same server. Configure its host, port and credentials in the app settings, or use the app's setup flow when qBittorrent is missing.

Version 1.8.0 adds case-insensitive torrent name search in the sidebar. Search works together with the selected state filter and existing sort order. A separate empty result message distinguishes no matching torrents from an empty library. Clear the search field to return to the complete filtered list.

Version 1.9.0 chooses folders with the shared mvmOS folder window, which opens in the middle of the screen. When adding a torrent, or moving one from its details, it starts at the save path currently entered or last remembered; the same applies to adding an IPTorrents result. It shows only this server and keeps you inside the signed-in user's own home folder: you can go back up as far as that folder but not into system folders. A saved path outside the home folder, or one that no longer exists, opens the home folder instead. The app needs mvmOS 1.21.0.

The dashboard retains its torrent controls, file and peer details, traffic statistics and optional IPTorrents search. IPTorrents requires your own session cookies; qBittorrent must expose its WebUI API. This app manages real downloads and files on the server.

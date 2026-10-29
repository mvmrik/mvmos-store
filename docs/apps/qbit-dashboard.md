# qBit Dashboard

qBit Dashboard connects to the qBittorrent WebUI running on the same server. Configure its host, port and credentials in the app settings, or use the app's setup flow when qBittorrent is missing.

Version 1.8.0 adds case-insensitive torrent name search in the sidebar. Search works together with the selected state filter and existing sort order. A separate empty result message distinguishes no matching torrents from an empty library. Clear the search field to return to the complete filtered list.

When adding a torrent, the folder picker starts at the save path currently entered. The same applies to adding an IPTorrents result. With no entered path, the picker starts in the current user's home folder.

The dashboard retains its torrent controls, file and peer details, traffic statistics and optional IPTorrents search. IPTorrents requires your own session cookies; qBittorrent must expose its WebUI API. This app manages real downloads and files on the server.

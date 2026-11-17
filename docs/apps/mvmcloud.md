# mvmCloud

mvmCloud 1.2.0 provides private storage for Apps Hub profiles, with a desktop window and an optional public page. Its system backend requires administrator confirmation at installation.

## Private files and shared places

Upload files, create folders and browse photos or videos. The usage display shows server free space and any profile quota. The place selector includes folders shared with your profile and places offered by the administrator. Permissions distinguish preview, download, upload and deletion; the server rechecks current access for requests. A shared single file exposes only that file.

Use Share for a file or folder to select people and rights. Review existing shares, change their rights or revoke them. The administrator's Shared places section can offer a folder from the current Linux home or a connected folder from another mvmOS server, to selected profiles or everyone. Remote rights cannot exceed those of the source server.

## Public links

Create a public link to a file or folder, optionally with a password, for a visitor without an account. Remove or change its password or revoke the link. The app's public page must remain enabled. Encrypted folders, their descendants and folders containing them are excluded; an existing link also stops exposing a tree that later contains an encrypted folder.

## Remote uploads and compatibility

Requires Core 1.23.0 or later for shared folder operations. With Core 1.26.0 on both servers, a remote upload uses a signed ticket for one file and maximum size and travels from the browser directly to the source server. The folder access key is never given to the profile. Older sources use the app's normal upload fallback through this server. Remote places cannot move files or recursively delete nonempty folders.

## Premium and APIs

Ordinary files and sharing work without Premium. The separate Premium module controls quotas, permission to create encrypted folders and user-issued API keys. Administrator and eligible profile API keys are limited to a chosen folder and permitted file operations; they never offer a shell. Encrypted file contents and names are unlocked in the browser with the folder password.

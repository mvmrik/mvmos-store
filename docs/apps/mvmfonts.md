# mvmFonts

mvmFonts is a shelf of free fonts that stays on your own server, for apps that write. It is available in the Productivity Store category and has a window on the mvmOS desktop. Apps use the fonts through the Apps Hub app-to-app API, so nothing is loaded from a third-party font service and visitors of public pages are not sent anywhere else.

## What comes with it

About one hundred families with Latin and Cyrillic letters, taken from Google Fonts: sans-serif, serif, monospace and display or handwriting faces. Every family has its regular weight and, where the designer made them, bold and italic. Each file is trimmed to Latin, Latin Extended and Cyrillic and saved as woff2, so the whole app stays small, and a browser downloads only the files for the characters a page really shows. The fonts are published under open licences (SIL Open Font License 1.1, Apache 2.0 and the Ubuntu Font Licence); the licence of each family is shown in its details and the texts are in `LICENSES.md`.

## The window

Search by name, filter by group, and type your own sample text to see every font with it. Click a card to see all its weights and styles, each drawn in its own shape, and its licence.

## Your own fonts

An administrator can upload a font file (woff2, woff, ttf or otf, up to 6 MB) with a family name, weight, italic and group. Add each weight or italic as its own file with the same family name. The same name and weight replaces the earlier file; a family can be removed file by file. You are responsible for having the right to use and share a font you upload. Uploaded fonts are kept in `apps/mvmfonts/storage/custom/`; they and the bundled fonts are served without a login, because a browser cannot send one when it loads a font.

## Use from other apps

Switch the App API of mvmFonts on in Apps Hub → Settings → App APIs; it is off by default. Apps then ask `list_fonts` and receive every family with its styles and file URLs. mvmOffice uses it for the font button in the text toolbar and for the fonts of cover texts, and mvmPhoto offers the fonts in its Text tool. If mvmFonts is not installed or its App API is off, the app simply shows no fonts.

An app on the desktop can also load `/pub/mvmfonts/client.js`, which asks `list_fonts` through the platform API, adds the `@font-face` rules and offers `has`, `stack` and `ready` helpers; when mvmFonts is missing the file does not exist and the app carries on without it.

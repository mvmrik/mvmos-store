# mvmOffice

Store applications can register their own file types. A document saved from mvmOffice opens in mvmOffice when it is the default application for that type. The user can change the choice in Settings under Default apps or through File Manager’s Open with menu.

## Books and long documents

File ▸ Document properties sets the document type. A text document is the default. A book turns the pages in the side panel into chapters, adds a front and a back cover (the Front cover and Back cover entries in the side panel, or the File menu), starts every chapter on a new page and sets an A5 page with mirrored margins, page numbers on the outer edge and a running header. All of it can be changed afterwards in Page setup, and the same page settings (mirrored margins, number on the outer edge, running header) are available to every document.

Any document can contain a table of contents built from its headings (☰ in the toolbar; the printed and previewed copy shows page numbers), links, pictures and notes. A note is a number in the text; click it to read or change the note. The notes are listed at the end of the page, which in a book is the end of the chapter.

Export to e-book (.epub) makes every page a chapter, builds the navigation from the headings and turns notes into footnotes that open as a pop-up in readers that support it. Word (.docx) export carries the cover, table of contents field, pictures, links and notes. PDF is the print preview saved by the browser.

### Designing the covers

Each cover is a page of the book's size that you lay out freely: pictures (as many as you like), texts, rectangles, ellipses and lines, on a background colour. Drag an item to move it, use the corner handles to resize it and the round handle to turn it. While you drag, pink lines show the middle of the page and the edges of the other items, the distances to the neighbours are shown in millimetres and turn pink when they are equal, and the dashed frame marks the 5 mm safe area. Hold Alt to move freely, use the arrow keys to nudge, Ctrl+D to duplicate, Ctrl+Z / Ctrl+Y to undo and redo. Texts have fonts, sizes, alignment, spacing and effects: soft shadow, outline, glow, gradient, highlight band and long shadow. A picture can fill the page or fit inside it. On a phone the tools sit in a row above the page and the properties below it.

The covers are printed and exported as a picture of the finished page, so they look the same on paper, in Word and in the e-book. The e-book uses the front cover only.

### Book preview

File ▸ Book preview opens the book full screen, closed, and then opens it; turn the leaves with the arrow keys, a click on either side, a swipe or the play button. Every page is laid out exactly as it is printed, with margins, numbers, running headers, the table of contents and notes, so empty spaces and distances can be checked and fixed before printing. On a narrow screen one page is shown at a time.

## Fonts

When mvmFonts is installed and its App API is switched on (Apps Hub → Settings → App APIs), the text toolbar gets a font button (Aa) and the cover editor lists the same fonts in its font menu, grouped as sans, serif, monospace, display and your own fonts. Pick a font for the selected text, or for the place where you are about to type; "Default font" returns to the standard one. Without mvmFonts, or with its App API off, nothing about fonts appears and documents look as before.

A document stores only the name of the font. Printing, the print preview, the book preview and the PDF wait for the fonts to load before the pages are measured, so the sheets break where they will print. An e-book export carries the fonts the text uses inside the EPUB (only those, in Latin and Cyrillic subsets) so a reader shows the same shapes. A Word export names the font but cannot carry it, so Word replaces it with another one on a computer that does not have it. A document that uses a font the server no longer has falls back to a generic serif, sans-serif or monospace face until the font is back.

## Notes and the writing assistant

Every document has a Notes page in the side panel, under the covers. It is an ordinary page of text for the plan of the book — what happens in each chapter, the characters, the places, the dates — and it is never printed or exported.

With Premium, the ✨ Assistant button in the top bar opens a conversation next to the text. The assistant sees the notes, the list of chapters, the chapter being written, the selected text and the covers, and works with tools: it can write or replace a chapter, continue one, fix or rewrite a selection, replace a piece of text, add, rename, move or delete chapters, rewrite or extend the notes and lay out the covers. It reads other chapters when it needs them, treats the notes as the truth when writing and updates them when facts change, and says so when the new text disagrees with the notes or an earlier chapter. Changes are shown before they are applied and can be undone; turn off Review changes to apply them at once. Pictures cannot be created, only kept and moved.

The assistant uses the AI mvmAI is set up with; mvmAI must be installed and its app API switched on in Apps Hub. The text of the open document is sent to that AI. Only the document that is open is available to the assistant.

### Pictures and credits

When mvmAI has an image generator ready, the assistant can make pictures: a picture for the front or back cover (placed behind the cover text, filling the page) or an illustration at the start or end of a chapter. It writes the description of the picture from the notes and the chapters, adds what you ask for in your message, and states whether any text may appear in the picture; by default there is none, and the title and author are laid out as real text over it. Each picture is a card you accept (or it is made at once with Review changes off), takes a minute or more and can be replaced by asking again. The assistant does not know or care which generator makes the picture.

A message and a picture can each cost credits; the administrator sets the prices under Apps Hub (Credit services). A price is charged first and given back when the answer or the picture fails.

### Settings for the administrator

In the app's settings (Settings for mvmOffice in the App Store) the administrator switches the assistant on or off for the whole installation, switches its pictures on or off, and decides whether it is offered on public pages (Apps Hub profiles). All three are on by default. Without a Premium subscription the switches are locked and a click opens the subscription dialog; on public pages nothing about the assistant appears unless it is available and switched on.

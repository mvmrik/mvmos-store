# mvmDesign

mvmDesign is a desktop page designer for still images and videos assembled directly from the editable pages. It runs in the browser and does not require mvmPhoto or mvmVideo to be installed. It also has a public Apps Hub page.

## Design a page

Add text, a picture, rectangle, ellipse or line, or choose a starter template. Select an element to edit its properties. Drag to move it and use its bottom-right corner to resize it; the position, size and rotation fields provide precise control. Arrow keys move the selection, with Shift for a larger step. Layers can be brought forward, sent backward and locked. A picture can fill the page as its background. Common toolbar actions use icons with translated tooltips and accessible names.

Dragging shows guides for the page center, edges and other elements, with snapping at the current canvas zoom. Equal gaps between neighboring elements show distance guides in project pixels. A position badge shows the moving element’s X/Y coordinates. Hold Alt to bypass snapping; releasing commits one undo step and canceling a pointer gesture restores the original position.

The text panel offers font, weight, italics, alignment, line spacing, letter spacing, fill colors, a gradient, outline, shadow/glow and a colored background panel. A visual gallery offers 24 quick styles shared with subtitles: plain, outline, glow, gold, box, neon, hollow letters, offset outline, echo, glitch, 3D depth, retro layers, chrome, silver, fire, ice, ocean, sunset, candy, comic, sticker, embossed, stripes and chromatic text. These include layered glyph effects, metallic bands and striped fills as well as gradients and preset colors. Choose an effect and adjust its intensity, colors, outline and shadow after applying a style. The text stays editable; the same renderer draws gallery thumbnails, previews, images and video frames. Font size and element position/size are relative to the page, so they scale with output resolution. A long text is fitted inside its element's box. Colors, number fields, selectors and effect sliders update the canvas while you adjust them. Controls stay mounted so the color chooser and text cursor remain usable. One continuous field edit creates one Undo step; Escape cancels an unfinished edit and restores its previous value and history. The same immediate preview applies to shared and individual subtitle settings. Empty or incomplete number input leaves the current design intact until a valid value is entered.

When mvmFonts is installed and its App API is enabled in Apps Hub settings, its fonts appear in both page-text and subtitle selectors. Font files load before rendering. The font button opens the reusable mvmFonts picker: search by family name and preview your actual text in each font before choosing it. You can edit the preview sample without changing your design; canceling leaves the selected font unchanged. Fonts remain supplied by mvmFonts rather than being embedded in the project; install the same fonts on another server to retain typography.

## Reuse designs in video

Switch to Video. Each timeline occurrence references a page, so several occurrences can use one chorus design. A design edit updates all its occurrences. Duplicate the page for an independent variation.

Select a page on the left and choose **Use selected page again** to append an occurrence. Click an occurrence to set its duration or page, choose an instant change or a crossfade, or move it left/right. Shift-click several occurrences and choose **Repeat selected** to copy the block after the selection. This duplicates references and timing, not the page designs.

Import an audio file using Music or drop one into the window. Initial occurrence durations are distributed proportionally across the audio. **Fit to song** redistributes them again. The waveform supports seeking and the zoom buttons adjust timeline scale.

Choose **Time to music** to play from the beginning. Press **Next page** or Space at each desired change. **Finish timing** keeps the current page until the end of the song and removes later occurrences that were not used during the pass. **Cancel** restores the original sequence and timings. Undo is available after finishing.

## Animate elements

In Design, select an element and configure Appear, Disappear, delay and animation duration. Available effects include fade, directional slide and zoom; text also supports typewriter and word-by-word appearance. These restart at each occurrence. Static image exports show the entire design regardless of animation settings.

The preview and the exported video share the same drawing and animation renderer. Page crossfades and element animation are independent controls.

## Add subtitles

The Subtitles tab can add cues individually, import SRT, or paste subtitle text with one segment per line. Pasted segments stay in the left-hand library without assigned times. Each compact library row has a drag handle on the left and a text button. Right-click for Edit subtitle text or Delete. Click the text once to start displaying the subtitle at the current playhead, then click the same row again to record its end and remove it from the library. Music keeps playing throughout, and the growing timeline block follows the current position. Clicking a different row closes the current subtitle and starts the new one at the same moment. Leaving a gap between the second click and the next first click creates a gap without subtitles. An open interval closes automatically at the playback end. Dragging a row onto the timeline instead gives it an initial three-second duration that can be adjusted visually. Return to library removes a selected cue from the timeline while preserving its text and individual style. SRT imports retain their supplied timings. Cue times are elapsed seconds, independent of regional calendar/time settings.

Use **Time subtitles while listening** and press Space or **Next subtitle** at each change to record subtitle timings in order. If library segments exist, the pass uses those and keeps already placed cues. Finishing keeps the current subtitle to the audio end and leaves unused library segments available; cancel restores the original project. Without library segments, the pass retimes the existing cues and removes later cues not used in the pass. You can also select a cue and use Start here/End here at the playhead, or edit its numerical start/end.

The timeline shows Music, Pages and Subtitles on one shared time axis. Drag a subtitle block to move it without changing its duration; drag either edge to trim its start or end. Blocks snap to the playhead, page boundaries and neighboring subtitle edges. Hold Alt to bypass snapping. Arrow keys adjust a focused subtitle or edge by 0.01 seconds, or 0.1 seconds with Shift. The selected subtitle's text and exact start/end fields (to milliseconds) appear at the top of the inspector. Click or drag the ruler/waveform to seek, and zoom around the playhead for close adjustments.

During Play, active subtitles are highlighted in the timeline and the playhead follows the music. Overlapping subtitles use separate visual lanes and are stacked in the rendered frame unless given an individual vertical position. Preview this subtitle plays the selected interval with the video's page design and music, then pauses at its end. A drag pauses playback while adjusting; playback resumes on release if it was already running. Each drag creates a single undo step, and pointer cancellation restores the original interval.

Open Subtitle style & animation for the same 24-style gallery and glyph effects as page text, plus typewriter and karaoke display, fonts, colors, gradients, outline width, shadow, background opacity, alignment, weight, italics, spacing and opacity. Applying a visual style preserves the selected font, size, timing, position and appearance/disappearance animation; karaoke or typewriter display remains enabled if selected. Choose All subtitles for shared defaults or This subtitle for per-cue overrides. Each individual setting has a checkbox: checked means a personal value; unchecked inherits the current shared value. Editing a value enables its override automatically. Use all shared settings removes all overrides from that cue.

While paused, select a subtitle in the preview and drag its frame to position it, or its bottom-right handle to resize it. The same alignment and equal-spacing guides work against page elements and other active captions. In All subtitles mode, moving an inherited subtitle updates the shared position. A cue with personal geometry, an overlapping cue or a resize automatically switches to individual settings. Numeric X/Y/width/height controls use page percentages. Simultaneous subtitles stack by default; an individual Y position overrides that stacking.

Appearance and disappearance can independently fade, slide or zoom; incoming text can also appear by character or word. Animation duration is configurable. These settings are stored in the project and use the same renderer in preview and video export. Karaoke distributes words uniformly inside each cue: there is no automatic transcription, beat detection or alignment to sung syllables. Captions are burned into video exports and can also be downloaded separately as SRT. Still-page exports do not include the global subtitle track.

## Save and recover

Save writes a `.mvmdesign` file to a server folder; Save to folder selects a new location. Download project saves a copy to the computer. Open file, Open from server and File Manager's registered file association reopen projects. Projects embed imported images and audio along with page designs, page references, captions and timing.

Changes also create a browser-local IndexedDB draft for the current Linux user. Recover draft restores that draft; this is a convenience copy in that browser, not a server backup. Save/download the project regularly, especially for large audio files or pictures. Individual imported assets are limited to 250 MB. Undo retains up to 30 edits.

## Export

- One page: PNG, JPEG or WebP. PNG retains the rendered pixels without lossy compression.
- All pages: a ZIP with numbered image files in page order; one page exports directly as an image.
- Animated video: native or half project resolution, 24/25/30/60 fps, and Standard, High or Maximum quality. Choose Automatic, MP4 (H.264/AAC) or WebM (VP9/Opus, with VP8 fallback). Unsupported codec combinations produce an error, rather than silently omitting audio. Automatic tries MP4 first and then WebM.

The browser renders every frame independently of preview speed, then encodes once. Video codecs are lossy; Maximum quality is not a mathematical lossless mode. Increasing resolution cannot recreate detail absent from source pictures. Keep the app open until rendering finishes. Audio is resampled to stereo at 48 kHz, with 192 kbps at Standard and 320 kbps at higher qualities. A video can also be exported without audio.

## Development

App files and licensed media library live under `apps/mvmdesign/`; there is no app backend or dependency on mvmVideo's runtime globals. All UI translations live in its own `public/i18n.js` and cover the nine platform languages.

# Stale pixels on the terminal canvas after a long background idle

Status: 2026-10-12. Root cause still not reproduced. Recovery and detection built
(see "What was built"); bundle built, not yet deployed by deploy.sh.

## Symptom

The webv4_custom terminal was left connected overnight with its panel minimized.
When it was reopened, the canvas showed leftover pieces of earlier screens mixed
in with current output. Moving to other BBS views, which clear the screen, did
not remove them, so the problem is in the canvas and not in the BBS state.

## What rules things out

`ClrScr` is `ScrollUpWindow(WindRows)`, and that calls `FastWrite(' ')` on every
cell. No code path skips a cell because its buffer is already blank. So whenever a
clear fails to remove old pixels, the blank-cell draw for that cell did nothing.
In `Crt.FastWrite` that happens in two ways:

1. **`CrtFont.GetChars()` returns `undefined`.** The cell is flagged
   `NeedsRedraw` and nothing is drawn. `FlushNeedsRedraw()` then exits at once
   while `Font.Loading > 0`. If `_Loading` ever stays above zero, for example
   because a font PNG `onload`/`onerror` never fires for an orphaned `Image` in a
   frozen background tab, every 16-colour write becomes a no-op permanently.
   24-bit block cells keep painting because `FastWriteBlocks` uses `fillRect` and
   never reads the font. The result would be partly live and partly frozen.
   `SetFont` runs on every iframe `resize`/`refit` message, which makes overnight
   resize events (display sleep, monitor changes) the likely trigger.

2. **The cached glyph sheet drawn from is blank or transparent.**
   `GetChars()` keeps up to 48 colour sheets (`_CharsMap`) as canvases. It builds
   them from the font canvas with `getImageData`, and the alpha channel comes
   from that canvas. Chrome can drop or hibernate the backing store of
   GPU-accelerated 2D canvases in hidden tabs. A GPU reset after OS sleep also
   fires `contextlost` and later `contextrestored`, after which the canvas is
   cleared. Neither the Crt canvas nor the font canvas nor the sheet canvases
   listens for those events. If a sheet or the font canvas comes back
   transparent, `drawImage` composites nothing (source-over) and the old pixels
   show through. That matches what was seen: stale content that clearing does
   not remove, while some attributes still render.

The `FastForward` / `BeginOffscreenRender` path (d5c296c) looked suspicious but
seems fine. It always restores the contexts in a `finally`, and it ends with
`InvalidateAll` + `FlushNeedsRedraw`. Scrolls during offscreen replay copy
*from* the real canvas into a dummy, which does no harm.

## Correction found while building the fix

Spaces and solid block glyphs never touch the glyph sheets. `FastWriteBlocks`
is gated on `Fore24`/`Back24 > 0x0F`, and those fields hold RGB values, so even
plain 16-colour text qualifies. A clear (`ESC[2J`) therefore paints every cell
with `fillRect`, straight onto the Crt canvas. Theories 1 and 2 would make new
text invisible, but a clear would still wipe the screen. Neither explains old
pixels that survive a clear on their own.

Something that survives a clear has to be either outside the 25 live rows or a
canvas the browser is not presenting. The best remaining candidate is the
first: on desktop, modern scrollback puts 250 rows of old output *above* the
live screen on the same canvas, and the container is pinned to the bottom with
`scrollTop`. If that view drifts upward (a resize or a debounced
`SetScreenSize` that is not followed by `scrollToBottom()`), recent
scrolled-off screens show at the top and clears never touch them. During
`FastForward` the real scrollback region is not shifted, so it holds whatever
was there when the panel was hidden.

## Next time it happens, before reloading

First check the viewport (same console context as below):

```js
var cc = document.querySelector('.fTelnetClientContainer');
console.log('gap px', cc.scrollHeight - cc.clientHeight - cc.scrollTop,
  'canvas', _ftClient.Crt.Canvas.width + 'x' + _ftClient.Crt.Canvas.height,
  'css', _ftClient.Crt.Canvas.style.width, _ftClient.Crt.Canvas.style.height,
  'container', cc.clientWidth + 'x' + cc.clientHeight);
```

A non-zero gap means the scrollback theory. If the new code is live, the
console will already show `[iframe] terminal viewport was ...px above` or
`fTelnet: rendering recovered (...)`. Those lines say which check fired.


Open devtools, select the `terminal-iframe.html` frame in the console context
dropdown, and run:

```js
var c = _ftClient._Crt, f = c._Font;
console.log('font loading =', f.Loading);
var k = Object.keys(f._CharsMap);
console.log('sheets =', k.length, k.map(function (n) {
  var cv = f._CharsMap[n];
  if (!cv.width) return n + ': zero-size';
  var d = cv.getContext('2d').getImageData(0, 0, 1, 1).data;
  return n + ': a=' + d[3];
}));
console.log('font canvas px', f._CanvasContext.getImageData(0, 0, 1, 1).data);
```

- `font loading` > 0 → theory 1 (stuck load).
- Sheets with `a=0`, or a font canvas reading all zeros → theory 2 (lost backing store).

Then try this repair, which tests theory 2 directly:

```js
f._CharsMap = []; f._CharsMapLru = []; f._CharMap = []; f._CharMapLru = [];
f._Canvas.width = f._Png.width; f._Canvas.height = f._Png.height;
f._CanvasContext.drawImage(f._Png, 0, 0);
c.InvalidateAll(); c.FlushNeedsRedraw();
```

For theory 1, set `f._Loading = 0` first, then run the same repair.

## Original proposal (now built, see below)

Add `Crt.RecoverRendering()` in the library, built from the repair above: drop
both glyph caches, redraw the font canvas from `_Png`, reset a stuck `_Loading`
once the PNG is `complete`, then `InvalidateAll()` + `FlushNeedsRedraw()`. It
costs one full repaint, about a frame. Call it from:

- `contextrestored` on the Crt canvas and the font canvas,
- the host's `visibilitychange` → visible and the panel `focus` message, when
  the terminal has been hidden longer than N minutes,
- a watchdog that runs when `Font.Loading > 0` has lasted more than ~10 s.

Optional detection: on return to visible, read one pixel from a few cells
whose buffered glyph is a space and compare it with the cell's `Back24`. Call
`RecoverRendering()` on a mismatch.

## What was built

Library (`source/crt/CrtFont.ts`, `source/crt/Crt.ts`):

- `Crt.RecoverRendering(reason)` drops both glyph caches, redraws the font
  canvas from the PNG, resolves a stuck load, replaces the scroll scratch
  canvas, then runs `InvalidateAll` + `FlushNeedsRedraw`. It refuses to run
  during offscreen replay or on a lost context, and logs
  `fTelnet: rendering recovered (reason), #n`. `Crt.RecoveryCount` counts runs.
- `Crt.CheckRendering()` takes one `getImageData` of the live area and checks
  the centre pixel of up to 32 blank cells against their background colour.
  It returns the number of mismatches.
- `contextrestored` on the Crt canvas (blacks out scrollback first) and on the
  font canvas triggers recovery.
- `FlushNeedsRedraw` doubles as a watchdog: a font load older than
  `CrtFont.STUCK_LOAD_MS` (10 s) is recovered. Either the missed PNG is
  applied, or the load is restarted. `OnPngLoad` no longer lets the count go
  negative, and ignores a late onload whose `_Png` has not loaded.

Host (`webv4_custom/root/terminal-iframe.html`, installRenderKeepUp):

- Records when the terminal was hidden (tab hidden or panel blur). On return
  it re-pins the viewport to the bottom if it drifted (and logs it). After
  10+ min hidden it always runs `RecoverRendering`; for shorter absences it
  runs `CheckRendering` and recovers on any mismatch.

Tests: scratchpad Playwright scripts. One drives the bundle directly: lost
sheets, lost font canvas plus a `contextrestored` event, stuck load, wiped
main canvas, scrolling after recovery, refusal while offscreen, and no false
positives on 16-colour/24-bit/scrolled screens. The other runs the real
`terminal-iframe.html` against `ws_ansi_server.js` through blur, corruption
and focus. Every check passed.

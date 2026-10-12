fTelnet Enhanced
================

An HTML5 WebSocket BBS terminal client. A fork of
[rickparrish/fTelnet](https://github.com/rickparrish/fTelnet) with the
rendering, colour, audio and graphics work needed to drive a modern BBS
front end.

Everything below is in the library itself, so a host page does not need to
patch the bundle at runtime to get it.

What's different
----------------

**24-bit colour that holds up in practice.** The upstream SGR parser handles
well-formed `38;2;r;g;b`, but real BBS output is not always well-formed.
Colon-delimited variants (`38:2:r:g:b`) are common, and some servers send the
colour bytes ahead of the introducer. Those are normalized before parsing
rather than by loosening the parser. Sequences split across network reads are
reassembled.

**Block-drawing fast path.** Solid blocks (space, `█`, `▄`, `▀`) in 24-bit
colour are drawn as rectangles instead of through the glyph cache. The cache
bakes a canvas per attribute combination, which is a good trade at 16 colours
and a bad one at 24-bit, where gradient art uses a different colour in almost
every cell.

**Bounded glyph caches.** Cache keys include the 24-bit colours, so with
truecolor an unbounded cache grows until the tab dies. Both caches are now
LRU-bounded, evicted sheet canvases release their raster immediately, and
truecolor glyphs go through the small per-glyph cache rather than baking a
whole glyph sheet per colour pair (gradient art was baking ~300 sheets a
second and discarding them).

**Wheel reporting.** With mouse reporting on, wheel motion is reported as
buttons 64/65 (SGR or X10 form to match the mode), one report per notch
with trackpad deltas accumulated, which is what SyncTERM sends and what a
Synchronet host with `CON_MOUSE_SCROLL` translates to up/down. With
reporting off nothing is sent, so a host can fall back to arrow keys.

**No DOM growth.** Upstream appended a hidden `<div>` under the canvas for
every printed text run as screen-reader fallback, removed only on a full
screen clear. Anything that repaints in place without clearing (idle
screensavers, live boards) grew the DOM without bound: measured at ~580 divs
a second and ~30 MB a minute of renderer memory, 880,000 divs after fifteen
minutes. The fallback is removed; the canvas is the only thing shown.

**Unthrottled rendering.** `Options.BitsPerSecond = 0` drains the receive
buffer instead of pacing reads to emulate a modem, and continuations run on
microtasks rather than `setTimeout(0)`, which browsers clamp to 4ms and far
more in a background tab. Any positive value keeps the modem emulation.

**Backlog catch-up.** `FastForward()` replays buffered data with drawing
redirected to off-screen canvases and paints the result once, so a host that
stops pumping while its terminal is hidden can catch up in one frame instead
of rendering everything it missed. `Poll()` covers hosts where an `ondata`
event can be missed.

**Sixel graphics.** `ESC P ... q ... ESC \` is decoded and drawn. Colour
registers in RGB and HLS, repeat counts, carriage return and newline, raster
attributes, and the VT340 default palette. Other device control strings are
left alone.

**A bell you can live with.** The upstream bell is a 200ms sine at full scale
wired straight to the destination, which measures 0.0 dBFS. It is now a short
two-partial blip with a percussive decay: 14 dB quieter at peak, 26 dB
quieter RMS, and out in 113ms. `Crt.BellEnabled` turns it off,
`Crt.SoundVolume` sets the master level for all sound.

**Audio that survives autoplay policy.** The `AudioContext` is created on
first use rather than at construction, so it is not stuck `suspended` before
the first user gesture.

Building
--------

Requires Node. `npm install` is run for you on first build.

    ./build.sh            # compile and bundle into release/
    ./build.sh --clean    # arguments are passed through to tsc

Windows users can still use `build.cmd`.

Output lands in `release/` as four variants, with and without RIP graphics
and file transfer support:

    ftelnet.norip.noxfer.min.js     ftelnet.rip.noxfer.min.js
    ftelnet.norip.xfer.min.js       ftelnet.rip.xfer.min.js

Deploying
---------

    ./deploy.sh                     # install into a Synchronet webv4 tree
    ./deploy.sh --debug             # install the unminified build instead

    FTELNET_VARIANT=rip.xfer ./deploy.sh
    WEBV4_CUSTOM=/path/to/webv4_custom ./deploy.sh

The bundle resolves its fonts, CSS and virtual keyboard assets relative to
its own `<script src>`. `deploy.sh` copies them alongside it. If you install
the bundle by hand, keep `fonts/`, `ftelnet.css` and `keyboard/` in the same
directory or every glyph will 404.

Host integration notes
----------------------

`client.Options`, `client.Crt` and `client.Connection` are public, so a host
should not need to touch underscore-prefixed internals.

For a terminal that can be hidden by a single-page app:

```js
// on hide: stop pumping and let data queue up
onHide  = () => { hidden = true; };
// on show: replay the backlog in one paint
onShow  = () => { hidden = false; client.FastForward(); };
// and while visible, keep up
tick    = () => { if (!hidden) { client.Poll(); client.Crt.FlushNeedsRedraw(); } };
```

Licence
-------

AGPL-3.0, inherited from upstream. If you serve a modified copy to browsers
you are conveying it, so publish your source.

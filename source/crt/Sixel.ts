/*
  fTelnet: An HTML5 WebSocket client
  Copyright (C) Rick Parrish, R&M Software

  This file is part of fTelnet.

  fTelnet is free software: you can redistribute it and/or modify
  it under the terms of the GNU Affero General Public License as
  published by the Free Software Foundation, either version 3 of the
  License, or any later version.

  fTelnet is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU Affero General Public License for more details.

  You should have received a copy of the GNU Affero General Public License
  along with fTelnet.  If not, see <http://www.gnu.org/licenses/>.
*/

/// <summary>
/// Decoder for sixel graphics, as carried in a Device Control String.
/// </summary>
/// <remarks>
/// A sixel stream is a DCS whose payload is 'q' followed by drawing
/// commands. Each data byte in the range ? to ~ encodes a vertical strip of
/// six pixels, one bit per pixel, hence the name. The cursor advances one
/// column per data byte, and '-' moves down to the next band of six rows.
///
/// Reference: DEC VT330/VT340 Programmer Reference Manual, chapter 14, and
/// https://gitlab.synchro.net/main/sbbs/-/blob/master/src/conio/cterm.adoc
/// </remarks>
class Sixel {
    // VT340 default colour registers, as RGB percentages.
    private static DEFAULT_PALETTE: number[][] = [
        [0, 0, 0], [20, 20, 80], [80, 13, 13], [20, 80, 20],
        [80, 20, 80], [20, 80, 80], [80, 80, 20], [53, 53, 53],
        [26, 26, 26], [33, 33, 60], [60, 26, 26], [33, 60, 33],
        [60, 33, 60], [33, 60, 60], [60, 60, 33], [80, 80, 80]
    ];

    // Guard against a malformed or hostile stream allocating unbounded
    // memory. 4096x4096 at 4 bytes per pixel is already 64MB.
    public static MAX_WIDTH: number = 4096;
    public static MAX_HEIGHT: number = 4096;

    /// <summary>
    /// Returns true if a DCS payload looks like sixel data.
    /// </summary>
    /// <remarks>
    /// The introducer is an optional P1;P2;P3 parameter list followed by
    /// 'q'. Anything else in a DCS is some other device control string and
    /// is not ours to handle.
    /// </remarks>
    public static IsSixel(payload: string): boolean {
        return /^[0-9;]*q/.test(payload);
    }

    /// <summary>
    /// Decodes a DCS payload into a canvas, or null if it is not sixel data
    /// or contains nothing drawable.
    /// </summary>
    public static Decode(payload: string): HTMLCanvasElement | null {
        if (!Sixel.IsSixel(payload)) { return null; }

        var data: string = payload.substring(payload.indexOf('q') + 1);

        var size: number[] = Sixel.Measure(data);
        var width: number = size[0];
        var height: number = size[1];
        if (width <= 0 || height <= 0) { return null; }

        var canvas: HTMLCanvasElement = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        var context: CanvasRenderingContext2D | null = canvas.getContext('2d');
        if (context === null) { return null; }

        var image: ImageData = context.createImageData(width, height);
        Sixel.Render(data, image, width, height);
        context.putImageData(image, 0, 0);

        return canvas;
    }

    /// <summary>
    /// Walks the stream tracking only the cursor, to size the bitmap before
    /// allocating it. Honours raster attributes when present.
    /// </summary>
    private static Measure(data: string): number[] {
        var x: number = 0;
        var maxX: number = 0;
        var band: number = 0;
        var i: number = 0;
        var length: number = data.length;

        while (i < length) {
            var ch: string = data.charAt(i);

            if (ch === '"') {
                // Raster attributes: Pan;Pad;Ph;Pv. When both dimensions are
                // given they are authoritative, so stop measuring.
                var raster: any = Sixel.ReadParams(data, i + 1);
                var params: number[] = raster.Params;
                if (params.length >= 4 && params[2] > 0 && params[3] > 0) {
                    return [
                        Math.min(params[2], Sixel.MAX_WIDTH),
                        Math.min(params[3], Sixel.MAX_HEIGHT)
                    ];
                }
                i = raster.Index;
                continue;
            }

            if (ch === '#') {
                i = Sixel.ReadParams(data, i + 1).Index;
                continue;
            }

            if (ch === '!') {
                var repeat: any = Sixel.ReadParams(data, i + 1);
                var count: number = repeat.Params.length > 0 ? repeat.Params[0] : 1;
                i = repeat.Index;
                if (i < length && Sixel.IsDataByte(data.charAt(i))) {
                    x += count;
                    if (x > maxX) { maxX = x; }
                    i++;
                }
                continue;
            }

            if (ch === '$') { x = 0; i++; continue; }
            if (ch === '-') { x = 0; band++; i++; continue; }

            if (Sixel.IsDataByte(ch)) {
                x++;
                if (x > maxX) { maxX = x; }
                i++;
                continue;
            }

            i++;
        }

        return [
            Math.min(maxX, Sixel.MAX_WIDTH),
            Math.min((band + 1) * 6, Sixel.MAX_HEIGHT)
        ];
    }

    /// <summary>
    /// Second pass: actually sets pixels.
    /// </summary>
    private static Render(data: string, image: ImageData, width: number, height: number): void {
        var palette: number[][] = [];
        for (var p: number = 0; p < Sixel.DEFAULT_PALETTE.length; p++) {
            palette[p] = [
                Math.round(Sixel.DEFAULT_PALETTE[p][0] * 255 / 100),
                Math.round(Sixel.DEFAULT_PALETTE[p][1] * 255 / 100),
                Math.round(Sixel.DEFAULT_PALETTE[p][2] * 255 / 100)
            ];
        }

        var colour: number[] = palette[0];
        var x: number = 0;
        var band: number = 0;
        var i: number = 0;
        var length: number = data.length;

        while (i < length) {
            var ch: string = data.charAt(i);

            if (ch === '"') {
                i = Sixel.ReadParams(data, i + 1).Index;
                continue;
            }

            if (ch === '#') {
                var colourSpec: any = Sixel.ReadParams(data, i + 1);
                var params: number[] = colourSpec.Params;
                i = colourSpec.Index;

                if (params.length >= 5) {
                    // Defining a register: Pc;Pu;Px;Py;Pz
                    var register: number = params[0];
                    if (params[1] === 1) {
                        palette[register] = Sixel.HlsToRgb(params[2], params[3], params[4]);
                    } else {
                        palette[register] = [
                            Math.round(Math.min(100, params[2]) * 255 / 100),
                            Math.round(Math.min(100, params[3]) * 255 / 100),
                            Math.round(Math.min(100, params[4]) * 255 / 100)
                        ];
                    }
                    colour = palette[register];
                } else if (params.length >= 1) {
                    // Selecting a register.
                    colour = palette[params[0]] || palette[0];
                }
                continue;
            }

            if (ch === '!') {
                var repeatSpec: any = Sixel.ReadParams(data, i + 1);
                var count: number = repeatSpec.Params.length > 0 ? repeatSpec.Params[0] : 1;
                i = repeatSpec.Index;
                if (i < length && Sixel.IsDataByte(data.charAt(i))) {
                    var bits: number = data.charCodeAt(i) - 0x3F;
                    for (var r: number = 0; r < count; r++) {
                        Sixel.PlotSixel(image, width, height, x + r, band * 6, bits, colour);
                    }
                    x += count;
                    i++;
                }
                continue;
            }

            if (ch === '$') { x = 0; i++; continue; }
            if (ch === '-') { x = 0; band++; i++; continue; }

            if (Sixel.IsDataByte(ch)) {
                Sixel.PlotSixel(image, width, height, x, band * 6, data.charCodeAt(i) - 0x3F, colour);
                x++;
                i++;
                continue;
            }

            i++;
        }
    }

    /// <summary>
    /// Writes one six-pixel vertical strip.
    /// </summary>
    private static PlotSixel(image: ImageData, width: number, height: number, x: number, top: number, bits: number, colour: number[]): void {
        if (x < 0 || x >= width) { return; }

        for (var bit: number = 0; bit < 6; bit++) {
            if ((bits & (1 << bit)) === 0) { continue; }

            var y: number = top + bit;
            if (y < 0 || y >= height) { continue; }

            var offset: number = ((y * width) + x) * 4;
            image.data[offset] = colour[0];
            image.data[offset + 1] = colour[1];
            image.data[offset + 2] = colour[2];
            image.data[offset + 3] = 255;
        }
    }

    private static IsDataByte(ch: string): boolean {
        var code: number = ch.charCodeAt(0);
        return code >= 0x3F && code <= 0x7E;
    }

    /// <summary>
    /// Reads a ';'-separated numeric parameter list starting at index, and
    /// returns the values plus the index of the first byte after them.
    /// </summary>
    private static ReadParams(data: string, index: number): any {
        var params: number[] = [];
        var current: string = '';

        while (index < data.length) {
            var ch: string = data.charAt(index);
            if (ch >= '0' && ch <= '9') {
                current += ch;
                index++;
            } else if (ch === ';') {
                params.push(current === '' ? 0 : parseInt(current, 10));
                current = '';
                index++;
            } else {
                break;
            }
        }

        if (current !== '') { params.push(parseInt(current, 10)); }

        return { Params: params, Index: index };
    }

    /// <summary>
    /// Converts the HLS form used by colour register definitions, where hue
    /// is in degrees and lightness/saturation are percentages, to RGB.
    /// </summary>
    /// <remarks>
    /// Sixel measures hue from blue rather than from red, so the incoming
    /// angle is rotated before the usual conversion.
    /// </remarks>
    private static HlsToRgb(hue: number, lightness: number, saturation: number): number[] {
        var h: number = ((hue + 240) % 360) / 360;
        var l: number = Math.min(100, lightness) / 100;
        var s: number = Math.min(100, saturation) / 100;

        if (s === 0) {
            var grey: number = Math.round(l * 255);
            return [grey, grey, grey];
        }

        var q: number = l < 0.5 ? l * (1 + s) : l + s - (l * s);
        var p: number = (2 * l) - q;

        return [
            Math.round(Sixel.HueToChannel(p, q, h + (1 / 3)) * 255),
            Math.round(Sixel.HueToChannel(p, q, h) * 255),
            Math.round(Sixel.HueToChannel(p, q, h - (1 / 3)) * 255)
        ];
    }

    private static HueToChannel(p: number, q: number, t: number): number {
        if (t < 0) { t += 1; }
        if (t > 1) { t -= 1; }
        if (t < 1 / 6) { return p + ((q - p) * 6 * t); }
        if (t < 1 / 2) { return q; }
        if (t < 2 / 3) { return p + ((q - p) * ((2 / 3) - t) * 6); }
        return p;
    }
}

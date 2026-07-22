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
/// CTerm physical key reporting: separate key-down and key-up edges, reported
/// as Linux evdev scancodes.
/// </summary>
/// <remarks>
/// A terminal normally delivers a keypress as the character it produces, which
/// cannot express "held" or "released" and collapses chords. Games need both,
/// so CTerm added an optional mode - enabled with CSI = 1 h, disabled with
/// CSI = 1 l - in which keys are reported as CSI = code K on press and
/// CSI = code k on release.
///
/// In a browser this maps cleanly onto keydown/keyup, so no auto-repeat
/// filtering guesswork is needed: repeats are suppressed by tracking which
/// codes are currently held.
///
/// Codes are Linux evdev, matching what SyncTERM reports, so a door written
/// against SyncTERM needs no changes.
/// </remarks>
class PhysicalKeys {
    /// <summary>
    /// KeyboardEvent.code -> Linux evdev scancode.
    /// </summary>
    private static CODE_TO_EVDEV: any = {
        'Escape': 1,
        'Digit1': 2, 'Digit2': 3, 'Digit3': 4, 'Digit4': 5, 'Digit5': 6,
        'Digit6': 7, 'Digit7': 8, 'Digit8': 9, 'Digit9': 10, 'Digit0': 11,
        'Minus': 12, 'Equal': 13, 'Backspace': 14, 'Tab': 15,
        'KeyQ': 16, 'KeyW': 17, 'KeyE': 18, 'KeyR': 19, 'KeyT': 20,
        'KeyY': 21, 'KeyU': 22, 'KeyI': 23, 'KeyO': 24, 'KeyP': 25,
        'BracketLeft': 26, 'BracketRight': 27, 'Enter': 28, 'ControlLeft': 29,
        'KeyA': 30, 'KeyS': 31, 'KeyD': 32, 'KeyF': 33, 'KeyG': 34,
        'KeyH': 35, 'KeyJ': 36, 'KeyK': 37, 'KeyL': 38,
        'Semicolon': 39, 'Quote': 40, 'Backquote': 41, 'ShiftLeft': 42,
        'Backslash': 43,
        'KeyZ': 44, 'KeyX': 45, 'KeyC': 46, 'KeyV': 47, 'KeyB': 48,
        'KeyN': 49, 'KeyM': 50, 'Comma': 51, 'Period': 52, 'Slash': 53,
        'ShiftRight': 54, 'NumpadMultiply': 55, 'AltLeft': 56, 'Space': 57,
        'CapsLock': 58,
        'F1': 59, 'F2': 60, 'F3': 61, 'F4': 62, 'F5': 63, 'F6': 64,
        'F7': 65, 'F8': 66, 'F9': 67, 'F10': 68,
        'NumLock': 69, 'ScrollLock': 70,
        'Numpad7': 71, 'Numpad8': 72, 'Numpad9': 73, 'NumpadSubtract': 74,
        'Numpad4': 75, 'Numpad5': 76, 'Numpad6': 77, 'NumpadAdd': 78,
        'Numpad1': 79, 'Numpad2': 80, 'Numpad3': 81, 'Numpad0': 82,
        'NumpadDecimal': 83,
        'F11': 87, 'F12': 88,
        'NumpadEnter': 96, 'ControlRight': 97, 'NumpadDivide': 98,
        'AltRight': 100, 'Home': 102, 'ArrowUp': 103, 'PageUp': 104,
        'ArrowLeft': 105, 'ArrowRight': 106, 'End': 107, 'ArrowDown': 108,
        'PageDown': 109, 'Insert': 110, 'Delete': 111,
        'MetaLeft': 125, 'MetaRight': 126
    };

    /// <summary>
    /// Fallback for browsers or synthetic events without .code, keyed on the
    /// legacy keyCode.
    /// </summary>
    private static KEYCODE_TO_EVDEV: any = {
        8: 14, 9: 15, 13: 28, 16: 42, 17: 29, 18: 56, 27: 1, 32: 57,
        33: 104, 34: 109, 35: 107, 36: 102,
        37: 105, 38: 103, 39: 106, 40: 108,
        45: 110, 46: 111,
        48: 11, 49: 2, 50: 3, 51: 4, 52: 5, 53: 6, 54: 7, 55: 8, 56: 9, 57: 10,
        65: 30, 66: 48, 67: 46, 68: 32, 69: 18, 70: 33, 71: 34, 72: 35,
        73: 23, 74: 36, 75: 37, 76: 38, 77: 50, 78: 49, 79: 24, 80: 25,
        81: 16, 82: 19, 83: 31, 84: 20, 85: 22, 86: 47, 87: 17, 88: 45,
        89: 21, 90: 44,
        112: 59, 113: 60, 114: 61, 115: 62, 116: 63, 117: 64,
        118: 65, 119: 66, 120: 67, 121: 68, 122: 87, 123: 88
    };

    public static ToEvdev(ke: KeyboardEvent): number {
        var byCode: number = PhysicalKeys.CODE_TO_EVDEV[(<any>ke).code];
        if (typeof byCode === 'number') { return byCode; }

        var byKeyCode: number = PhysicalKeys.KEYCODE_TO_EVDEV[ke.keyCode];
        if (typeof byKeyCode === 'number') { return byKeyCode; }

        return -1;
    }

    /// <summary>Key-down report for an evdev code.</summary>
    public static Down(code: number): string {
        return '\x1B[=' + code.toString(10) + 'K';
    }

    /// <summary>Key-up report for an evdev code.</summary>
    public static Up(code: number): string {
        return '\x1B[=' + code.toString(10) + 'k';
    }
}

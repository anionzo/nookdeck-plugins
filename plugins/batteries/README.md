# Batteries

Battery levels on one tile. macOS only.

<img src="preview.png" width="264" alt="A 2x2 Batteries tile with demo data: a charging Mac, a Magic Mouse low on battery and AirPods Pro">

- **This Mac:** percent, charging, and the time left when macOS has an estimate. A Mac without a battery shows only devices.
- **Magic Keyboard, Mouse and Trackpad**, and other Bluetooth devices that tell macOS their level.
- **AirPods:** one row, showing the lower of the two sides, with left (L), right (R) and case under the bar. "L+R" means both sides are the same. With one earbud in, only that side is shown. The unnamed "Bluetooth Device" macOS also lists for the case is not shown twice.
- An owner's name after an Apple model name, as in "AirPods Pro nam99", is left out.

The Mac is on top, then the other devices from the lowest level up. A device that is not connected is hidden. A device that does not report a level to macOS cannot be shown. The tile refreshes every 60 seconds.

The bar is green above 50%, amber from 20% to 50% and red below 20%. In amber and red, the icon and the number take the color too.

## Access

`shell`: `pmset -g batt`, `ioreg -r -c AppleDeviceManagementHIDEventService -l` and `system_profiler SPBluetoothDataType -json`. All three only read. Their output includes device addresses and serial numbers: the plugin does not save, log or send them. Only names and levels go to the phone.

## Tile settings

**Style**: the plugin is not told how large its tile is, so choose the style that fits.

| Style | Tile | Shows |
|---|---|---|
| `details` (default) | 2x2, 4x2 | Each device with its bar and a second line. A 2x2 tile fits three devices. |
| `compact` | 2x1 | The first two devices of the list, without the second line. |
| `lowest` | 1x1 | Only the lowest battery: icon, percent and name. |

With more than six devices the second line is left out. The `details` style shows at most seven and counts the rest.

**Show this Mac's battery**: turn it off to show only accessories.

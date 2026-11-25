# Batteries

Battery levels on one tile. macOS only.

<img src="preview.png" width="264" alt="A 2x2 Batteries tile with demo data: a Mac, AirPods Pro, a Magic Keyboard and a Magic Mouse">

- **This Mac:** percent, charging, and the time left when macOS has an estimate. A Mac without a battery shows only devices.
- **Magic Keyboard, Mouse and Trackpad**, and other Bluetooth devices that tell macOS their level.
- **AirPods:** the lower of the two sides, with left (L), right (R) and case under the name.

A device that is not connected is hidden. A device that does not report a level to macOS cannot be shown. The tile refreshes every 60 seconds.

Red is 10% or less, amber 20% or less. With more than six devices the second line is left out, and the tile shows at most eight.

## Access

`shell`: `pmset -g batt`, `ioreg -r -c AppleDeviceManagementHIDEventService -l` and `system_profiler SPBluetoothDataType -json`. All three only read. Their output includes device addresses and serial numbers: the plugin does not save, log or send them. Only names and levels go to the phone.

## Tile settings

**Show this Mac's battery**: turn it off to show only accessories.

# Battery Health

Battery Health adds a simple battery-preservation control to the Cinnamon panel on laptops that support Linux's standardized charge-threshold interface.

On supported systems, the applet offers two choices:

- **Maximize charge** — allow the battery to charge normally.
- **Preserve battery health** — use the charging limits provided by the laptop firmware and driver to reduce time spent at full charge.

The applet does not use manufacturer-specific commands and does not write directly to system power files. It uses the UPower service provided by the operating system.

## Linux Mint compatibility

Battery Health is being developed for the power-management stack expected in **Linux Mint 23 and newer**.

Linux Mint 22 uses an older UPower release that does not expose the standardized charge-threshold API required by this applet. The applet can load on Mint 22, but its charging controls remain unavailable.

**Do not install UPower packages from a newer Linux Mint or Ubuntu release just to enable this feature.** Use the normal Linux Mint upgrade path instead.

Support still depends on the laptop's kernel driver and firmware. If the system does not report charge-threshold support, Battery Health leaves the controls unavailable rather than guessing the manufacturer or forcing a hardware-specific method.

## Permissions and safety

Battery Health does not run `sudo`, does not install its own privileged helper, and does not write to `/sys` directly.

Charging-mode changes are requested through UPower's D-Bus API. UPower and Polkit remain responsible for authorization and for applying the setting through the kernel. With UPower's upstream default policy, an active local desktop session is allowed to change the charging mode.

## Technical note

The standardized UPower charge-threshold API was introduced in UPower 1.90.5. Systems that expose only `charge_control_end_threshold` need UPower 1.91.2 or newer for correct support detection; UPower 1.91.3 also includes additional charge-threshold detection fixes.

This distinction matters for some real laptops: the kernel may already expose a valid charge limit while an older UPower release cannot yet present it through the standardized desktop API. Battery Health deliberately does not bypass UPower in that situation.

## Development status

This is currently a proof of concept. The backend supports multiple system batteries, ignores peripheral batteries, follows device add/remove events and UPower restarts, and treats UPower's reported state as the source of truth.

Real-hardware testing with UPower 1.91.2/1.91.3, final UI review, and packaging assets are still pending before any Cinnamon Spices submission.

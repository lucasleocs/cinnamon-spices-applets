# Battery Health

Battery Health adds a simple battery-preservation control to the Cinnamon panel on laptops that support Linux's standardized charge-threshold interface.

On supported systems, the applet offers two choices:

- **Maximize charge (100%)** — allow the battery to charge normally.
- **Preserve battery health** — enable the preservation mode reported by the system. When UPower provides a reliable end threshold, the applet shows it directly, for example **Preserve battery health (80%)**.

When the system also reports a charging start threshold, Battery Health explains the full range, such as “Charging starts below 75% and stops at 80%.” If the limits are managed by firmware instead, the applet says so rather than inventing a percentage.

The applet does not use manufacturer-specific commands and does not write directly to system power files. It uses the UPower service provided by the operating system.

## Linux Mint compatibility

Battery Health is developed and supported for **Linux Mint running Cinnamon**. The current development baseline is **Cinnamon 6.7 or newer**.

Linux Mint 22.x uses Cinnamon 6.6 and an older UPower release that does not expose the standardized charge-threshold API required by this applet. Mint 22.x is therefore outside the supported compatibility baseline, and the applet is packaged so Cinnamon treats versions older than 6.7 as incompatible.

The 6.7 baseline is provisional during development and can be adjusted before the first Cinnamon Spices submission to match the stable Cinnamon release used by the first supported Linux Mint version.

**Do not install UPower packages from a newer Linux Mint or Ubuntu release just to enable this feature.** Use the normal Linux Mint upgrade path instead.

Support still depends on the laptop's kernel driver and firmware. Even on a supported Cinnamon version, Battery Health checks UPower's reported capabilities at runtime. If the system does not report charge-threshold support, Battery Health leaves the controls unavailable rather than guessing the manufacturer or forcing a hardware-specific method.

## Support scope

Other Linux distributions and other desktop environments are outside the project's supported compatibility matrix. Battery Health may happen to work on another distribution running Cinnamon, but that compatibility is incidental and is not a design, testing, or maintenance target.

## Why doesn't Preserve always show a percentage?

Some systems expose an explicit numeric charge-end threshold. When that value is available through UPower, Battery Health can show it directly, for example **Preserve battery health (80%)**.

Other systems provide firmware-controlled battery preservation without exposing a numeric limit to desktop applications. In that case, Battery Health shows **Preserve battery health** without a percentage and explains that the charging limits are managed by system firmware.

Battery Health does not guess a percentage. It only displays numeric limits that the system explicitly reports as supported.

## Can I choose a different percentage?

Not currently. The standardized UPower API used by Battery Health exposes the preservation thresholds configured for the system and provides a way to enable or disable them, but it does not currently provide a standardized method for desktop applications to choose arbitrary start or end percentages.

For example, if a system reports an 80% preservation limit, Battery Health can show and enable that 80% mode, but it cannot safely replace it with 70% or 90% through the current standardized API.

Battery Health deliberately does not bypass UPower or write custom values directly to `/sys`. If UPower gains a standardized API for configurable thresholds in the future, custom percentages can be added without introducing manufacturer-specific or privileged code into the applet.

## Permissions and safety

Battery Health does not run `sudo`, does not install its own privileged helper, and does not write to `/sys` directly.

Charging-mode changes are requested through UPower's D-Bus API. UPower and Polkit remain responsible for authorizing the request and applying the setting through the kernel.

## Technical note

The standardized UPower charge-threshold API was introduced in UPower 1.90.5. Systems that expose only `charge_control_end_threshold` need UPower 1.91.2 or newer for correct support detection; UPower 1.91.3 also includes additional charge-threshold detection fixes.

This distinction matters for some real laptops: the kernel may already expose a valid charge limit while an older UPower release cannot yet present it through the standardized desktop API. Battery Health deliberately does not bypass UPower in that situation.

The applet treats UPower's capability flags as authoritative when displaying thresholds. For example, if a laptop supports only an end threshold, Battery Health shows only that end limit even if another numeric value is present in the D-Bus proxy.

## Development status

This is currently a proof of concept. The backend supports multiple system batteries, ignores peripheral batteries, follows device add/remove events and UPower restarts, and treats UPower's reported state as the source of truth.

The applet has been exercised in Cinnamon with simulated modern UPower devices covering end-threshold-only, start-and-end, firmware-controlled, and mixed multi-battery configurations. Enable/disable calls, state updates, and selective writes to only the batteries that need changing have also been verified in those simulated scenarios.

An earlier unversioned prototype was checked on Linux Mint 22 / Cinnamon 6.6 to confirm that the older UPower stack was handled safely. The current packaging intentionally places Cinnamon versions older than 6.7 outside the supported baseline instead of loading the applet there.

Real-hardware testing with UPower 1.91.2/1.91.3, final UI review, and packaging assets are still pending before any Cinnamon Spices submission.

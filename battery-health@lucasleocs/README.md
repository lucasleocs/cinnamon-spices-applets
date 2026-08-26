# Battery Health

A Cinnamon applet for controlling standardized laptop battery charge limiting through UPower.

The applet does not contain vendor-specific battery logic and does not access sysfs directly. It discovers UPower devices and only considers present system batteries that report charge-threshold support.

## Current development status

The applet currently discovers supported system batteries, tracks enabled, disabled, mixed, unsupported, and unavailable states, and exposes explicit **Maximize charge** and **Preserve battery health** choices through UPower's `EnableChargeThreshold()` D-Bus method.

Multiple supported batteries are handled independently. The applet only writes batteries that need to change to the requested mode, ignores peripheral batteries, and tracks device add/remove events and UPower service restarts so stale callbacks cannot overwrite the current state.

This is still a development version. Packaging assets, broader real-hardware testing, and final UI review will be completed before submission to Cinnamon Spices.

## Requirements

- Cinnamon
- UPower with the charge-threshold D-Bus API (introduced in UPower 1.90.5 or provided as a backport)
- A Linux kernel driver/firmware combination that exposes battery charge-threshold support to UPower

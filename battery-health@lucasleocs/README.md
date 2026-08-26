# Battery Health

A Cinnamon applet for controlling standardized laptop battery charge limiting through UPower.

The applet does not contain vendor-specific battery logic and does not access sysfs directly. It discovers UPower devices and only considers present system batteries that report charge-threshold support.

## Current development status

The applet currently discovers supported system batteries, tracks enabled, disabled, mixed, unsupported, and unavailable states, and exposes a **Preserve battery health** switch through UPower's `EnableChargeThreshold()` D-Bus method.

Multiple supported batteries are handled independently. Peripheral batteries are ignored, and the applet tracks device add/remove events and UPower service restarts so stale callbacks cannot overwrite the current state.

This is still a development version. Packaging assets and broader real-hardware testing will be added before submission to Cinnamon Spices.

## Requirements

- Cinnamon
- UPower with the charge-threshold D-Bus API (introduced in UPower 1.90.5 or provided as a backport)
- A Linux kernel driver/firmware combination that exposes battery charge-threshold support to UPower

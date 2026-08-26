# Battery Health

A Cinnamon applet for controlling standardized laptop battery charge limiting through UPower.

The applet does not contain vendor-specific battery logic and does not access sysfs directly. It discovers UPower devices and only considers present system batteries that report charge-threshold support.

## Current development status

The first development checkpoint is read-only: it discovers supported batteries and reports whether battery health charging is enabled, disabled, mixed across multiple batteries, unsupported, or temporarily unavailable.

The enable/disable control will be added after the discovery and lifecycle behavior is validated.

## Requirements

- Cinnamon
- UPower with the charge-threshold D-Bus API (introduced in UPower 1.90.5 or provided as a backport)
- A Linux kernel driver/firmware combination that exposes battery charge-threshold support to UPower

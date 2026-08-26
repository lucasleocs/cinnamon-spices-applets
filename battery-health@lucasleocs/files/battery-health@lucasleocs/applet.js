const Applet = imports.ui.applet;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const St = imports.gi.St;
const UPowerGlib = imports.gi.UPowerGlib;
const Extension = imports.ui.extension;
const PopupMenu = imports.ui.popupMenu;

const UUID = "battery-health@lucasleocs";
const UPOWER_BUS_NAME = "org.freedesktop.UPower";
const UPOWER_OBJECT_PATH = "/org/freedesktop/UPower";
const { DeviceKind: UPDeviceKind } = UPowerGlib;

const CHARGE_THRESHOLD_START = 1;
const CHARGE_THRESHOLD_END = 2;
const CHARGE_THRESHOLD_FIRMWARE = 4;

const DEVICE_STATE_PROPERTIES = new Set([
    "Type",
    "PowerSupply",
    "IsPresent",
    "ChargeThresholdEnabled",
    "ChargeThresholdSupported",
    "ChargeStartThreshold",
    "ChargeEndThreshold",
    "ChargeThresholdSettingsSupported",
]);

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(text) {
    return Gettext.dgettext(UUID, text);
}

const UPowerInterface = `<node>
  <interface name="org.freedesktop.UPower">
    <method name="EnumerateDevices">
      <arg name="devices" type="ao" direction="out" />
    </method>
    <signal name="DeviceAdded">
      <arg name="device" type="o" />
    </signal>
    <signal name="DeviceRemoved">
      <arg name="device" type="o" />
    </signal>
  </interface>
</node>`;

const UPowerDeviceInterface = `<node>
  <interface name="org.freedesktop.UPower.Device">
    <method name="EnableChargeThreshold">
      <arg name="chargeThreshold" type="b" direction="in" />
    </method>
    <property name="Type" type="u" access="read" />
    <property name="PowerSupply" type="b" access="read" />
    <property name="IsPresent" type="b" access="read" />
    <property name="ChargeThresholdEnabled" type="b" access="read" />
    <property name="ChargeThresholdSupported" type="b" access="read" />
    <property name="ChargeStartThreshold" type="u" access="read" />
    <property name="ChargeEndThreshold" type="u" access="read" />
    <property name="ChargeThresholdSettingsSupported" type="u" access="read" />
  </interface>
</node>`;

const UPowerProxy = Gio.DBusProxy.makeProxyWrapper(UPowerInterface);
const UPowerDeviceProxy = Gio.DBusProxy.makeProxyWrapper(UPowerDeviceInterface);

function isSystemBattery(device) {
    return device.Type === UPDeviceKind.BATTERY &&
        device.PowerSupply === true &&
        device.IsPresent === true;
}

function isChargeThresholdBattery(device) {
    return isSystemBattery(device) && device.ChargeThresholdSupported === true;
}

function getThresholdState(devices) {
    const systemBatteries = devices.filter(isSystemBattery);

    // Gio's D-Bus proxy returns null for declared properties that are absent from
    // the remote interface. This distinguishes old UPower from supported=false.
    if (systemBatteries.some(device => device.ChargeThresholdSupported == null))
        return "api-unavailable";

    const supported = systemBatteries.filter(isChargeThresholdBattery);

    if (supported.length === 0)
        return "unsupported";

    const enabledCount = supported.filter(device => device.ChargeThresholdEnabled === true).length;

    if (enabledCount === 0)
        return "disabled";
    if (enabledCount === supported.length)
        return "enabled";

    return "mixed";
}

function validThreshold(value) {
    return Number.isInteger(value) && value >= 0 && value <= 100;
}

function describeThresholdSettings(device) {
    const settings = Number.isInteger(device.ChargeThresholdSettingsSupported)
        ? device.ChargeThresholdSettingsSupported
        : 0;

    const start = (settings & CHARGE_THRESHOLD_START) !== 0 &&
        validThreshold(device.ChargeStartThreshold)
        ? device.ChargeStartThreshold
        : null;
    const end = (settings & CHARGE_THRESHOLD_END) !== 0 &&
        validThreshold(device.ChargeEndThreshold)
        ? device.ChargeEndThreshold
        : null;

    return {
        settings: settings & (
            CHARGE_THRESHOLD_START |
            CHARGE_THRESHOLD_END |
            CHARGE_THRESHOLD_FIRMWARE
        ),
        start,
        end,
        firmware: (settings & CHARGE_THRESHOLD_FIRMWARE) !== 0,
    };
}

function sameThresholdDescriptor(a, b) {
    return a.settings === b.settings &&
        a.start === b.start &&
        a.end === b.end;
}

function getThresholdDisplay(devices) {
    if (devices.length === 0)
        return { preserveEnd: null, infoKind: null, start: null, end: null };

    const descriptors = devices.map(describeThresholdSettings);
    const endValues = descriptors.map(item => item.end);
    const firstEnd = endValues[0];
    const preserveEnd = firstEnd !== null &&
        endValues.every(value => value === firstEnd)
        ? firstEnd
        : null;

    const first = descriptors[0];
    if (!descriptors.every(item => sameThresholdDescriptor(item, first)))
        return { preserveEnd, infoKind: "different", start: null, end: null };

    if (first.start !== null && first.end !== null)
        return { preserveEnd, infoKind: "range", start: first.start, end: first.end };
    if (first.end !== null)
        return { preserveEnd, infoKind: "end", start: null, end: first.end };
    if (first.start !== null)
        return { preserveEnd, infoKind: "start", start: first.start, end: null };
    if (first.firmware)
        return { preserveEnd: null, infoKind: "firmware", start: null, end: null };

    return { preserveEnd: null, infoKind: null, start: null, end: null };
}

class BatteryHealthApplet extends Applet.IconApplet {
    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);

        this.setAllowedLayout(Applet.AllowedLayout.BOTH);
        this.metadata = metadata;
        this._destroyed = false;
        this._rootProxy = null;
        this._rootSignalIds = [];
        this._devices = new Map();
        this._pendingDeviceTokens = new Map();
        this._writeInProgress = false;
        this._failedWriteTarget = null;
        // Async callbacks from a previous UPower owner must never update current state.
        this._upowerGeneration = 0;

        this.set_applet_icon_symbolic_name("battery-good-symbolic");
        this.set_applet_tooltip(_("Checking battery charge limit support"));

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);

        this._statusItem = new PopupMenu.PopupMenuItem(
            _("Checking battery charge limit support..."),
            { reactive: false }
        );
        this.menu.addMenuItem(this._statusItem);

        this._maximizeItem = new PopupMenu.PopupMenuItem(_("Maximize charge (100%)"));
        this._maximizeItem.actor.hide();
        this._maximizeItem.setSensitive(false);
        this._maximizeItem.connect("activate", () => this._setChargeThresholdEnabled(false));
        this.menu.addMenuItem(this._maximizeItem);

        this._preserveItem = new PopupMenu.PopupMenuItem(_("Preserve battery health"));
        this._preserveItem.actor.hide();
        this._preserveItem.setSensitive(false);
        this._preserveItem.connect("activate", () => this._setChargeThresholdEnabled(true));
        this.menu.addMenuItem(this._preserveItem);

        this._thresholdInfoItem = new PopupMenu.PopupMenuItem("", { reactive: false });
        this._thresholdInfoItem.actor.hide();
        this.menu.addMenuItem(this._thresholdInfoItem);

        this._reloadItem = new PopupMenu.PopupIconMenuItem(
            _("Reload Applet"),
            "view-refresh-symbolic",
            St.IconType.SYMBOLIC
        );
        this._reloadItem.connect("activate", () => this._reloadApplet());
        this._applet_context_menu.addMenuItem(this._reloadItem);

        this._upowerWatchId = Gio.bus_watch_name(
            Gio.BusType.SYSTEM,
            UPOWER_BUS_NAME,
            Gio.BusNameWatcherFlags.NONE,
            this._onUPowerAppeared.bind(this),
            this._onUPowerVanished.bind(this)
        );
    }

    _onUPowerAppeared(connection) {
        if (this._destroyed)
            return;

        const generation = ++this._upowerGeneration;

        // A new owner is a new UPower instance. Drop every proxy from the old one
        // before creating replacements so failures cannot leave stale state active.
        this._disconnectRootProxy();
        this._clearDevices();
        this._writeInProgress = false;
        this._failedWriteTarget = null;
        this._setState("checking");

        new UPowerProxy(connection, UPOWER_BUS_NAME, UPOWER_OBJECT_PATH, (proxy, error) => {
            if (this._destroyed || generation !== this._upowerGeneration)
                return;

            if (error) {
                global.logError(`${UUID}: failed to connect to UPower: ${error.message}`);
                this._setState("unavailable");
                return;
            }

            this._rootProxy = proxy;

            this._rootSignalIds.push(proxy.connectSignal(
                "DeviceAdded",
                (_proxy, _sender, [path]) => this._addDevice(connection, path, generation)
            ));
            this._rootSignalIds.push(proxy.connectSignal(
                "DeviceRemoved",
                (_proxy, _sender, [path]) => this._removeDevice(path, generation)
            ));

            this._enumerateDevices(connection, generation);
        });
    }

    _onUPowerVanished() {
        if (this._destroyed)
            return;

        this._upowerGeneration++;
        this._writeInProgress = false;
        this._failedWriteTarget = null;
        this._disconnectRootProxy();
        this._clearDevices();
        this._setState("unavailable");
    }

    _enumerateDevices(connection, generation) {
        this._rootProxy.EnumerateDevicesRemote((result, error) => {
            if (this._destroyed || generation !== this._upowerGeneration || this._rootProxy === null)
                return;

            if (error) {
                global.logError(`${UUID}: failed to enumerate UPower devices: ${error.message}`);
                this._setState("unavailable");
                return;
            }

            const paths = result && result[0] ? result[0] : [];
            for (const path of paths)
                this._addDevice(connection, path, generation);

            if (paths.length === 0)
                this._refreshState();
        });
    }

    _addDevice(connection, path, generation) {
        if (this._destroyed || generation !== this._upowerGeneration ||
            this._devices.has(path) || this._pendingDeviceTokens.has(path))
            return;

        // The same object path can disappear and be re-added while this proxy is loading.
        const requestToken = {};
        this._pendingDeviceTokens.set(path, requestToken);

        new UPowerDeviceProxy(connection, UPOWER_BUS_NAME, path, (proxy, error) => {
            if (this._destroyed || generation !== this._upowerGeneration ||
                this._pendingDeviceTokens.get(path) !== requestToken)
                return;

            this._pendingDeviceTokens.delete(path);

            if (error) {
                global.logError(`${UUID}: failed to inspect UPower device ${path}: ${error.message}`);
                this._refreshState();
                return;
            }

            const signalId = proxy.connect("g-properties-changed", (_proxy, changed, invalidated) => {
                const changedProperties = Object.keys(changed.deepUnpack());
                const relevantChange = changedProperties.some(name => DEVICE_STATE_PROPERTIES.has(name)) ||
                    (invalidated || []).some(name => DEVICE_STATE_PROPERTIES.has(name));

                if (relevantChange)
                    this._refreshState();
            });
            this._devices.set(path, { proxy, signalId });
            this._failedWriteTarget = null;
            this._refreshState();
        });
    }

    _removeDevice(path, generation) {
        if (generation !== this._upowerGeneration)
            return;

        this._pendingDeviceTokens.delete(path);

        const device = this._devices.get(path);
        if (device) {
            if (device.signalId)
                device.proxy.disconnect(device.signalId);
            this._devices.delete(path);
        }

        this._failedWriteTarget = null;
        this._refreshState();
    }

    _refreshState() {
        if (this._pendingDeviceTokens.size > 0) {
            this._setState("checking");
            return;
        }

        const devices = Array.from(this._devices.values(), item => item.proxy);
        this._setState(getThresholdState(devices));
    }

    _setChargeThresholdEnabled(enabled) {
        if (this._destroyed || this._writeInProgress)
            return;

        // Only write batteries that still need to reach the requested mode.
        const supportedPaths = Array.from(this._devices.entries())
            .filter(([_path, item]) =>
                isChargeThresholdBattery(item.proxy) &&
                item.proxy.ChargeThresholdEnabled !== enabled)
            .map(([path]) => path);

        if (supportedPaths.length === 0) {
            this._failedWriteTarget = null;
            this._refreshState();
            return;
        }

        this._writeInProgress = true;
        this._failedWriteTarget = null;
        this._maximizeItem.setSensitive(false);
        this._preserveItem.setSensitive(false);
        this._statusItem.label.set_text(_("Updating battery charging mode..."));
        this.set_applet_tooltip(_("Updating battery charging mode"));

        const generation = this._upowerGeneration;
        let index = 0;
        let failed = false;

        // Keep privileged UPower operations sequential rather than overlapping prompts/calls.
        const writeNext = () => {
            if (this._destroyed || generation !== this._upowerGeneration)
                return;

            while (index < supportedPaths.length) {
                const path = supportedPaths[index++];
                const item = this._devices.get(path);

                if (!item || !isChargeThresholdBattery(item.proxy) ||
                    item.proxy.ChargeThresholdEnabled === enabled)
                    continue;

                item.proxy.EnableChargeThresholdRemote(enabled, (_result, error) => {
                    if (this._destroyed || generation !== this._upowerGeneration)
                        return;

                    // A removed/re-added object path may now refer to another device proxy.
                    if (this._devices.get(path) !== item) {
                        writeNext();
                        return;
                    }

                    if (error) {
                        failed = true;
                        global.logError(`${UUID}: failed to change battery charge threshold for ${path}: ${error.message}`);
                    }

                    writeNext();
                });
                return;
            }

            this._writeInProgress = false;
            this._failedWriteTarget = failed ? enabled : null;
            this._refreshState();
        };

        writeNext();
    }

    _updateThresholdDetails(state) {
        const supportedState = state === "enabled" || state === "disabled" || state === "mixed";

        this._maximizeItem.label.set_text(_("Maximize charge (100%)"));
        this._preserveItem.label.set_text(_("Preserve battery health"));

        if (!supportedState) {
            this._thresholdInfoItem.actor.hide();
            return;
        }

        const supportedDevices = Array.from(this._devices.values(), item => item.proxy)
            .filter(isChargeThresholdBattery);
        const display = getThresholdDisplay(supportedDevices);

        if (display.preserveEnd !== null) {
            this._preserveItem.label.set_text(
                _("Preserve battery health (%d%%)").format(display.preserveEnd)
            );
        }

        let infoText = null;
        switch (display.infoKind) {
            case "range":
                infoText = _("ⓘ Charging starts below %d%% and stops at %d%%.")
                    .format(display.start, display.end);
                break;
            case "end":
                infoText = _("ⓘ Charging stops at %d%%.").format(display.end);
                break;
            case "start":
                infoText = _("ⓘ Charging starts below %d%%.").format(display.start);
                break;
            case "firmware":
                infoText = _("ⓘ Charging limits are managed by system firmware.");
                break;
            case "different":
                infoText = _("ⓘ Charging limits differ between batteries.");
                break;
        }

        if (infoText === null) {
            this._thresholdInfoItem.actor.hide();
            return;
        }

        this._thresholdInfoItem.label.set_text(infoText);
        this._thresholdInfoItem.actor.show();
    }

    _updateModeItems(state) {
        const supportedState = state === "enabled" || state === "disabled" || state === "mixed";

        if (!supportedState) {
            this._maximizeItem.setSensitive(false);
            this._preserveItem.setSensitive(false);
            this._maximizeItem.actor.hide();
            this._preserveItem.actor.hide();
            return;
        }

        this._maximizeItem.setOrnament(PopupMenu.OrnamentType.DOT, state === "disabled");
        this._preserveItem.setOrnament(PopupMenu.OrnamentType.DOT, state === "enabled");

        // Cinnamon 6.6 radio ornaments are reactive buttons. Keep them display-only
        // so clicks are handled by the menu item, matching newer Cinnamon behavior.
        if (this._maximizeItem._ornament && this._maximizeItem._ornament.child)
            this._maximizeItem._ornament.child.reactive = false;
        if (this._preserveItem._ornament && this._preserveItem._ornament.child)
            this._preserveItem._ornament.child.reactive = false;

        this._maximizeItem.setSensitive(!this._writeInProgress);
        this._preserveItem.setSensitive(!this._writeInProgress);
        this._maximizeItem.actor.show();
        this._preserveItem.actor.show();
    }

    _setState(state) {
        this._updateThresholdDetails(state);
        this._updateModeItems(state);

        if (this._writeInProgress) {
            this._statusItem.label.set_text(_("Updating battery charging mode..."));
            this.set_applet_tooltip(_("Updating battery charging mode"));
            return;
        }

        if ((this._failedWriteTarget === true && state === "enabled") ||
            (this._failedWriteTarget === false && state === "disabled"))
            this._failedWriteTarget = null;

        switch (state) {
            case "checking":
                this._statusItem.label.set_text(_("Checking battery charge limit support..."));
                this.set_applet_tooltip(_("Checking battery charge limit support"));
                break;
            case "enabled":
                this._statusItem.label.set_text(_("Battery health charging is enabled."));
                this.set_applet_tooltip(_("Battery health charging enabled"));
                break;
            case "disabled":
                this._statusItem.label.set_text(_("Battery health charging is available but disabled."));
                this.set_applet_tooltip(_("Battery health charging disabled"));
                break;
            case "mixed":
                this._statusItem.label.set_text(_("Batteries have different charging modes."));
                this.set_applet_tooltip(_("Mixed battery charging modes"));
                break;
            case "api-unavailable":
                this._statusItem.label.set_text(_(
                    "This feature requires newer system power-management support.\nOn Linux Mint, it is intended for Mint 23 or newer."
                ));
                this.set_applet_tooltip(_("Newer system power-management support is required"));
                break;
            case "unsupported":
                this._statusItem.label.set_text(_("Battery charge limiting is not supported by this system."));
                this.set_applet_tooltip(_("Battery charge limiting is not supported"));
                break;
            default:
                this._statusItem.label.set_text(_("UPower is not available."));
                this.set_applet_tooltip(_("Battery health charging unavailable"));
                break;
        }

        if (this._failedWriteTarget !== null &&
            (state === "enabled" || state === "disabled" || state === "mixed"))
            this._statusItem.label.set_text(_("Could not update all batteries."));
    }

    _reloadApplet() {
        this.menu.close();

        try {
            Extension.reloadExtension(this.metadata.uuid, Extension.Type.APPLET);
        } catch (error) {
            global.logError(`${UUID}: failed to reload applet: ${error.message}`);
        }
    }

    _disconnectRootProxy() {
        if (!this._rootProxy)
            return;

        for (const signalId of this._rootSignalIds)
            this._rootProxy.disconnectSignal(signalId);

        this._rootSignalIds = [];
        this._rootProxy = null;
    }

    _clearDevices() {
        for (const device of this._devices.values()) {
            if (device.signalId)
                device.proxy.disconnect(device.signalId);
        }

        this._devices.clear();
        this._pendingDeviceTokens.clear();
    }

    on_applet_clicked() {
        this.menu.toggle();
    }

    on_applet_removed_from_panel() {
        this._destroyed = true;

        if (this._upowerWatchId) {
            Gio.bus_unwatch_name(this._upowerWatchId);
            this._upowerWatchId = 0;
        }

        this._disconnectRootProxy();
        this._clearDevices();
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new BatteryHealthApplet(metadata, orientation, panelHeight, instanceId);
}

const Applet = imports.ui.applet;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const PopupMenu = imports.ui.popupMenu;

const UUID = "battery-health@lucasleocs";
const UPOWER_BUS_NAME = "org.freedesktop.UPower";
const UPOWER_OBJECT_PATH = "/org/freedesktop/UPower";
const UP_DEVICE_KIND_BATTERY = 2;

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
    <property name="Type" type="u" access="read" />
    <property name="PowerSupply" type="b" access="read" />
    <property name="IsPresent" type="b" access="read" />
    <property name="ChargeThresholdEnabled" type="b" access="read" />
    <property name="ChargeThresholdSupported" type="b" access="read" />
  </interface>
</node>`;

const UPowerProxy = Gio.DBusProxy.makeProxyWrapper(UPowerInterface);
const UPowerDeviceProxy = Gio.DBusProxy.makeProxyWrapper(UPowerDeviceInterface);

function isChargeThresholdBattery(device) {
    return device.Type === UP_DEVICE_KIND_BATTERY &&
        device.PowerSupply === true &&
        device.IsPresent === true &&
        device.ChargeThresholdSupported === true;
}

function getThresholdState(devices) {
    const supported = devices.filter(isChargeThresholdBattery);

    if (supported.length === 0)
        return "unsupported";

    const enabledCount = supported.filter(device => device.ChargeThresholdEnabled === true).length;

    if (enabledCount === 0)
        return "disabled";
    if (enabledCount === supported.length)
        return "enabled";

    return "mixed";
}

class BatteryHealthApplet extends Applet.IconApplet {
    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);

        this.metadata = metadata;
        this._destroyed = false;
        this._rootProxy = null;
        this._rootSignalIds = [];
        this._devices = new Map();
        this._pendingDevicePaths = new Set();

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

        new UPowerProxy(connection, UPOWER_BUS_NAME, UPOWER_OBJECT_PATH, (proxy, error) => {
            if (this._destroyed)
                return;

            if (error) {
                global.logError(`${UUID}: failed to connect to UPower: ${error.message}`);
                this._setState("unavailable");
                return;
            }

            this._disconnectRootProxy();
            this._clearDevices();
            this._rootProxy = proxy;

            this._rootSignalIds.push(proxy.connectSignal(
                "DeviceAdded",
                (_proxy, _sender, [path]) => this._addDevice(connection, path)
            ));
            this._rootSignalIds.push(proxy.connectSignal(
                "DeviceRemoved",
                (_proxy, _sender, [path]) => this._removeDevice(path)
            ));

            this._enumerateDevices(connection);
        });
    }

    _onUPowerVanished() {
        if (this._destroyed)
            return;

        this._disconnectRootProxy();
        this._clearDevices();
        this._setState("unavailable");
    }

    _enumerateDevices(connection) {
        this._rootProxy.EnumerateDevicesRemote((result, error) => {
            if (this._destroyed || this._rootProxy === null)
                return;

            if (error) {
                global.logError(`${UUID}: failed to enumerate UPower devices: ${error.message}`);
                this._setState("unavailable");
                return;
            }

            const paths = result && result[0] ? result[0] : [];
            for (const path of paths)
                this._addDevice(connection, path);

            if (paths.length === 0)
                this._refreshState();
        });
    }

    _addDevice(connection, path) {
        if (this._destroyed || this._devices.has(path) || this._pendingDevicePaths.has(path))
            return;

        this._pendingDevicePaths.add(path);

        new UPowerDeviceProxy(connection, UPOWER_BUS_NAME, path, (proxy, error) => {
            if (this._destroyed || !this._pendingDevicePaths.has(path))
                return;

            this._pendingDevicePaths.delete(path);

            if (error) {
                global.logError(`${UUID}: failed to inspect UPower device ${path}: ${error.message}`);
                this._refreshState();
                return;
            }

            const signalId = proxy.connect("g-properties-changed", () => this._refreshState());
            this._devices.set(path, { proxy, signalId });
            this._refreshState();
        });
    }

    _removeDevice(path) {
        this._pendingDevicePaths.delete(path);

        const device = this._devices.get(path);
        if (device) {
            if (device.signalId)
                device.proxy.disconnect(device.signalId);
            this._devices.delete(path);
        }

        this._refreshState();
    }

    _refreshState() {
        if (this._pendingDevicePaths.size > 0) {
            this._setState("checking");
            return;
        }

        const devices = Array.from(this._devices.values(), item => item.proxy);
        this._setState(getThresholdState(devices));
    }

    _setState(state) {
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
            case "unsupported":
                this._statusItem.label.set_text(_("Battery charge limiting is not supported by this system."));
                this.set_applet_tooltip(_("Battery charge limiting is not supported"));
                break;
            default:
                this._statusItem.label.set_text(_("UPower is not available."));
                this.set_applet_tooltip(_("Battery health charging unavailable"));
                break;
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
        this._pendingDevicePaths.clear();
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

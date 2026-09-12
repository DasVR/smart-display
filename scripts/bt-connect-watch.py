#!/usr/bin/env python3
"""Watches BlueZ for a device's Connected property flipping to True (an
actual audio connection, not just pairing) and tells the dashboard to
switch to the Music view via POST /api/bt/connected.

Companion to bt-auto-agent.py; runs as its own long-lived systemd service
(smart-display-bt-watch.service) so a stuck agent can't take the watcher
down with it.

Requires: python3-dbus, python3-gi (see scripts/bluetooth-audio-setup.sh)
"""
import json
import os
import urllib.request

import dbus
import dbus.mainloop.glib
from gi.repository import GLib

DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "http://localhost:3000") + "/api/bt/connected"


def device_label(bus, path):
	try:
		obj = bus.get_object("org.bluez", path)
		props = dbus.Interface(obj, "org.freedesktop.DBus.Properties")
		for key in ("Alias", "Name"):
			try:
				val = props.Get("org.bluez.Device1", key)
			except Exception:
				continue
			if val:
				return str(val)
	except Exception:
		return ""
	return ""


def notify_connected(name=""):
	payload = json.dumps({"name": name}).encode("utf-8")
	try:
		req = urllib.request.Request(
			DASHBOARD_URL,
			method="POST",
			data=payload,
			headers={"Content-Type": "application/json"},
		)
		urllib.request.urlopen(req, timeout=3)
		label = name or "device"
		print(f"notified dashboard: bluetooth connected ({label})")
	except Exception as e:
		print(f"failed to notify dashboard: {e}")


def on_properties_changed(interface, changed, invalidated, path=None, bus=None):
	if interface != "org.bluez.Device1":
		return
	if changed.get("Connected"):
		name = ""
		if bus and path:
			name = device_label(bus, path)
		notify_connected(name)


def main():
	dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
	bus = dbus.SystemBus()

	def handler(interface, changed, invalidated, path=None):
		on_properties_changed(interface, changed, invalidated, path=path, bus=bus)

	bus.add_signal_receiver(
		handler,
		dbus_interface="org.freedesktop.DBus.Properties",
		signal_name="PropertiesChanged",
		path_keyword="path",
	)
	print("watching for bluetooth connections...")
	GLib.MainLoop().run()


if __name__ == "__main__":
	main()

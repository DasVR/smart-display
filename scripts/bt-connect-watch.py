#!/usr/bin/env python3
"""Watches BlueZ for a device's Connected property flipping to True (an
actual audio connection, not just pairing) and tells the dashboard to
switch to the Music view via POST /api/bt/connected.

Companion to bt-auto-agent.py; runs as its own long-lived systemd service
(smart-display-bt-watch.service) so a stuck agent can't take the watcher
down with it.

Requires: python3-dbus, python3-gi (see scripts/bluetooth-audio-setup.sh)
"""
import os
import urllib.request

import dbus
import dbus.mainloop.glib
from gi.repository import GLib

DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "http://localhost:3000") + "/api/bt/connected"


def notify_connected():
	try:
		req = urllib.request.Request(DASHBOARD_URL, method="POST", data=b"")
		urllib.request.urlopen(req, timeout=3)
		print("notified dashboard: bluetooth connected")
	except Exception as e:
		print(f"failed to notify dashboard: {e}")


def on_properties_changed(interface, changed, invalidated, path=None):
	if interface != "org.bluez.Device1":
		return
	if changed.get("Connected"):
		notify_connected()


def main():
	dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
	bus = dbus.SystemBus()
	bus.add_signal_receiver(
		on_properties_changed,
		dbus_interface="org.freedesktop.DBus.Properties",
		signal_name="PropertiesChanged",
		path_keyword="path",
	)
	print("watching for bluetooth connections...")
	GLib.MainLoop().run()


if __name__ == "__main__":
	main()

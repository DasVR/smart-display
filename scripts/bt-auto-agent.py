#!/usr/bin/env python3
"""Persistent BlueZ pairing agent for smart-display.

Registers a NoInputNoOutput ("Just Works") agent so a phone can pair with
this box as a Bluetooth speaker without any PIN prompt or on-screen
confirmation — there's no display to show one on anyway. The agent only
exists for as long as this process holds the D-Bus registration, so it
runs as a long-lived systemd service (smart-display-bt-agent.service),
not a one-shot script.

Requires: python3-dbus, python3-gi (see scripts/bluetooth-audio-setup.sh)
"""
import dbus
import dbus.mainloop.glib
import dbus.service
from gi.repository import GLib

AGENT_PATH = "/smartdisplay/btagent"
AGENT_IFACE = "org.bluez.Agent1"


class AutoAgent(dbus.service.Object):
	"""Every method either returns normally (BlueZ treats that as ACCEPT)
	or would raise org.bluez.Error.Rejected to decline — we never decline."""

	@dbus.service.method(AGENT_IFACE, in_signature="", out_signature="")
	def Release(self):
		pass

	@dbus.service.method(AGENT_IFACE, in_signature="os", out_signature="")
	def AuthorizeService(self, device, uuid):
		return

	@dbus.service.method(AGENT_IFACE, in_signature="o", out_signature="s")
	def RequestPinCode(self, device):
		return "0000"

	@dbus.service.method(AGENT_IFACE, in_signature="o", out_signature="u")
	def RequestPasskey(self, device):
		return dbus.UInt32(0)

	@dbus.service.method(AGENT_IFACE, in_signature="ou", out_signature="")
	def DisplayPasskey(self, device, passkey):
		pass

	@dbus.service.method(AGENT_IFACE, in_signature="os", out_signature="")
	def DisplayPinCode(self, device, pincode):
		pass

	@dbus.service.method(AGENT_IFACE, in_signature="ou", out_signature="")
	def RequestConfirmation(self, device, passkey):
		return

	@dbus.service.method(AGENT_IFACE, in_signature="o", out_signature="")
	def RequestAuthorization(self, device):
		return

	@dbus.service.method(AGENT_IFACE, in_signature="", out_signature="")
	def Cancel(self):
		pass


def main():
	dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
	bus = dbus.SystemBus()
	agent = AutoAgent(bus, AGENT_PATH)
	manager = dbus.Interface(
		bus.get_object("org.bluez", "/org/bluez"), "org.bluez.AgentManager1"
	)
	manager.RegisterAgent(AGENT_PATH, "NoInputNoOutput")
	manager.RequestDefaultAgent(AGENT_PATH)
	print("smart-display bluetooth auto-pair agent running")
	GLib.MainLoop().run()


if __name__ == "__main__":
	main()

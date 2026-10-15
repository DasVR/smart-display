#!/bin/bash
# A quiet, quick boot for the wall (docs/boot.md). Run once on the wall, as root:
#
#   sudo scripts/boot/setup-quiet-boot.sh            set it up
#   sudo scripts/boot/setup-quiet-boot.sh --dry-run  show what it would change
#   sudo scripts/boot/setup-quiet-boot.sh --undo     put everything back
#
# Options: --no-splash (keep the boot splash as it is), --mode 1920x1080,
# --output HDMI-A-1 (the screen's mode and connector, for the kernel to start in).
#
# It:
#   1. hides the text: no boot menu, no kernel messages, no blinking cursor,
#      and the kernel starts the screen in its final mode, so the TV doesn't
#      re-sync again when the kiosk starts
#   2. installs the boot splash: the wall's standby light, breathing on black
#      (scripts/boot/plymouth), which the kiosk's boot page then carries on
#   3. installs this repo's server and kiosk units (no waiting for the network;
#      the kiosk takes over the console from the login prompt)
# Everything it replaces is kept as *.smart-display.bak, which --undo restores.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
THEME_DIR=/usr/share/plymouth/themes/smart-display
MODE=1920x1080
OUTPUT=HDMI-A-1
DRY=0
UNDO=0
SPLASH=1
while [ $# -gt 0 ]; do
	case "$1" in
		--dry-run) DRY=1 ;;
		--undo) UNDO=1 ;;
		--no-splash) SPLASH=0 ;;
		--mode) MODE="$2"; shift ;;
		--output) OUTPUT="$2"; shift ;;
		-h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) echo "Unknown option $1 (try --help)" >&2; exit 2 ;;
	esac
	shift
done

if [ "$DRY" = 0 ] && [ "$(id -u)" != 0 ]; then
	echo "Run it with sudo (or add --dry-run to just look)." >&2
	exit 1
fi

say() { echo "• $*"; }
run() {
	if [ "$DRY" = 1 ]; then echo "  would run: $*"; else "$@"; fi
}
backup() {
	# keep the first original only, so running this twice doesn't lose it
	if [ -e "$1" ] && [ ! -e "$1.smart-display.bak" ]; then run cp -a "$1" "$1.smart-display.bak"; fi
}
restore() {
	if [ -e "$1.smart-display.bak" ]; then run mv "$1.smart-display.bak" "$1"; say "restored $1"; fi
}

KERNEL_ARGS="quiet splash loglevel=3 rd.udev.log_level=3 systemd.show_status=auto vt.global_cursor_default=0 video=$OUTPUT:$MODE@60"
[ "$SPLASH" = 0 ] && KERNEL_ARGS="${KERNEL_ARGS/splash /}"

# add each word that isn't there yet (and replace an older video= for this output)
merge_args() {
	local have="$1" out="$1" a
	for a in $KERNEL_ARGS; do
		case "$a" in
			video=*) out="$(echo "$out" | sed -E "s#(^| )video=$OUTPUT:[^ ]*##g")"; out="$out $a" ;;
			*) case " $out " in *" $a "*) ;; *) out="$out $a" ;; esac ;;
		esac
	done
	echo "$out" | sed -E 's/^ +//; s/ +/ /g'
}

if [ "$UNDO" = 1 ]; then
	say "putting the boot back as it was"
	restore /etc/default/grub
	if [ -f /etc/default/grub ] && command -v update-grub >/dev/null; then run update-grub; fi
	restore /boot/firmware/cmdline.txt
	restore /etc/systemd/system/smart-display-server.service
	restore /etc/systemd/system/smart-display-kiosk.service
	if [ -d "$THEME_DIR" ]; then
		if command -v plymouth-set-default-theme >/dev/null; then
			PREV="$(cat "$THEME_DIR/previous-theme" 2>/dev/null || echo bgrt)"
			run plymouth-set-default-theme -R "$PREV" || true
		fi
		run rm -rf "$THEME_DIR"
		say "removed the splash theme"
	fi
	run systemctl enable getty@tty1.service || true
	run systemctl daemon-reload
	say "done; reboot to see it"
	exit 0
fi

# 1. the kernel's command line and the boot menu
if [ -f /etc/default/grub ]; then
	say "boot menu and kernel messages (GRUB)"
	backup /etc/default/grub
	CUR="$(sed -nE 's/^GRUB_CMDLINE_LINUX_DEFAULT="(.*)"/\1/p' /etc/default/grub | head -1)"
	NEW="$(merge_args "$CUR")"
	say "  kernel: $NEW"
	case " $NEW " in *" nomodeset "*) say "  note: nomodeset is set, so the splash can only show as text; remove it if the graphics driver works without it" ;; esac
	if [ "$DRY" = 0 ]; then
		set_grub() {
			if grep -qE "^$1=" /etc/default/grub; then sed -i -E "s#^$1=.*#$1=$2#" /etc/default/grub; else echo "$1=$2" >>/etc/default/grub; fi
		}
		set_grub GRUB_CMDLINE_LINUX_DEFAULT "\"$NEW\""
		set_grub GRUB_TIMEOUT 0
		set_grub GRUB_TIMEOUT_STYLE hidden
		# Ubuntu waits 30 s at a menu after any boot that didn't finish cleanly (a power cut)
		set_grub GRUB_RECORDFAIL_TIMEOUT 0
	fi
	command -v update-grub >/dev/null && run update-grub
elif [ -f /boot/firmware/cmdline.txt ]; then
	say "kernel messages (Raspberry Pi cmdline.txt)"
	backup /boot/firmware/cmdline.txt
	NEW="$(merge_args "$(head -1 /boot/firmware/cmdline.txt)")"
	say "  kernel: $NEW"
	[ "$DRY" = 0 ] && echo "$NEW" >/boot/firmware/cmdline.txt
else
	say "no GRUB or cmdline.txt found: add these to the kernel's command line by hand: $KERNEL_ARGS"
fi

# 2. the boot splash
if [ "$SPLASH" = 1 ]; then
	if [ -s /etc/crypttab ] && grep -qvE '^\s*(#|$)' /etc/crypttab; then
		say "the disk is encrypted: the splash shows the password prompt plainly"
	fi
	if ! command -v plymouth >/dev/null; then
		say "installing plymouth (the boot splash)"
		run apt-get install -y --no-install-recommends plymouth plymouth-label
	fi
	say "the splash: the standby light ($THEME_DIR)"
	run mkdir -p "$THEME_DIR"
	if [ "$DRY" = 0 ] && command -v plymouth-set-default-theme >/dev/null && [ ! -e "$THEME_DIR/previous-theme" ]; then
		plymouth-set-default-theme >"$THEME_DIR/previous-theme" 2>/dev/null || true
	fi
	run cp "$ROOT/scripts/boot/plymouth/smart-display.plymouth" "$ROOT/scripts/boot/plymouth/smart-display.script" "$THEME_DIR/"
	run python3 "$ROOT/scripts/boot/make-light.py" "$THEME_DIR/light.png"
	say "  rebuilding the initramfs with it (half a minute or so)"
	if command -v plymouth-set-default-theme >/dev/null; then
		run plymouth-set-default-theme -R smart-display
	else
		run update-alternatives --install /usr/share/plymouth/themes/default.plymouth default.plymouth "$THEME_DIR/smart-display.plymouth" 200
		run update-alternatives --set default.plymouth "$THEME_DIR/smart-display.plymouth"
		run update-initramfs -u
	fi
fi

# 3. the units
say "server and kiosk units (no network wait; the kiosk owns the console)"
for unit in smart-display-server.service smart-display-kiosk.service; do
	backup "/etc/systemd/system/$unit"
	run install -m 644 "$ROOT/$unit" "/etc/systemd/system/$unit"
done
run systemctl disable getty@tty1.service || true
run systemctl daemon-reload

say "done. Reboot to see it; afterwards, npm run boot-report shows how long each stage took."

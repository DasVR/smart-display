# Kiosk Systemd Units

## `smart-display-server.service`

```ini
[Unit]
Description=Smart Display Dashboard Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node /home/das/projects/smart-display/build/index.js
WorkingDirectory=/home/das/projects/smart-display
Restart=always
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

## `smart-display-kiosk.service`

```ini
[Unit]
Description=Smart Display Kiosk (Cage + Chromium)
After=smart-display-server.service

[Service]
Type=simple
User=das
ExecStartPre=/usr/bin/mkdir -p /run/user/1000
Environment="XDG_RUNTIME_DIR=/run/user/1000"
Environment="WAYLAND_DISPLAY=wayland-1"
ExecStart=/home/das/projects/smart-display/start-kiosk.sh
Restart=always

[Install]
WantedBy=graphical.target
```

## `start-kiosk.sh`

```bash
#!/bin/bash
set -e
export XDG_RUNTIME_DIR=/run/user/1000
export WAYLAND_DISPLAY=wayland-1

# Ensure seatd socket exists
mkdir -p /run/user/1000

# Force 1920x1080 output (critical for 4K panels)
wlr-randr --output HDMI-A-1 --mode 1920x1080

# Start Chromium in kiosk mode
/usr/bin/chromium-browser \
  --enable-features=UseOzonePlatform \
  --ozone-platform=wayland \
  --kiosk \
  --app=http://localhost:3000 \
  --no-first-run \
  --noerrdialogs \
  --disable-infobars \
  --disable-features=TranslateUI \
  --incognito
```

## Setup Commands

```bash
# Add user to required groups
sudo usermod -aG video,input,render das

# Enable seatd
sudo systemctl enable seatd
sudo systemctl start seatd

# Enable and start services
sudo systemctl enable smart-display-server smart-display-kiosk
sudo systemctl start smart-display-server smart-display-kiosk
```

## Troubleshooting

| Issue | Check |
|---|---|
| `Can't open display` | Is `seatd` running? Is user in `video`/`input`/`render` groups? |
| Only top-left quadrant | Did `wlr-randr` force 1920x1080? Is HDMI-A-1 the right output? |
| Chromium won't start | Try running `start-kiosk.sh` manually to see errors |
| Display blank after restart | Check `journalctl -u smart-display-kiosk` for chromium errors |

# Trystero Boilerplate

A minimal Vite site for testing two-peer browser connections with Trystero.

The demo joins a shared room, displays peer and relay connection status, and lets
connected peers exchange a simple ping message. It is set up to work on GitHub
Pages and can also be tested across devices on a local network with HTTPS.

## Run Locally

Install dependencies:

```powershell
npm install
```

Start the local dev server:

```powershell
npm run dev
```

## Test Across Devices

For LAN testing, use the HTTPS dev server so browser APIs required by Trystero
are available:

```powershell
npm run dev:https
```

Open the advertised `https://<local-ip>:5173/` URL on both devices and accept the
local certificate warning. Use the same room URL, including the `?room=` value,
on both devices.

## Build

```powershell
npm run build
```

The Vite config uses a relative base path so the built site can be served from a
GitHub Pages project URL.

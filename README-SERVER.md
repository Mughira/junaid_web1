# How to Fix CORS and Server Errors

## The Problem
When you open the HTML file directly (double-clicking it), the browser uses the `file://` protocol, which blocks API requests for security reasons. Additionally, Python's simple HTTP server doesn't support POST requests that Squarespace's JavaScript needs.

## Solution: Use the Node.js Server (Recommended)

### Quick Start (Easiest)
1. **Install Node.js** (if you don't have it): https://nodejs.org/
2. **Double-click**: `start-server-node.bat` (Windows)
   - OR right-click `start-server-node.ps1` → "Run with PowerShell"
3. **Open your browser**: `http://localhost:8000/kingship concierge.html`

### Manual Start
1. Open PowerShell or Command Prompt in this folder
2. Run: `node server.js`
3. Open: `http://localhost:8000/kingship concierge.html`

## Why This Server is Better
The included `server.js` Node.js server:
- ✅ Handles POST requests (fixes 501 errors)
- ✅ Returns proper responses for Squarespace API endpoints
- ✅ Serves all file types correctly
- ✅ Handles missing files gracefully

## Alternative Options

### Option 2: Using Python (Basic - Has Limitations)
1. Run: `python -m http.server 8000`
2. Open: `http://localhost:8000/kingship concierge.html`
   
**Note**: Python's server doesn't support POST requests, so you'll see 501 errors for API calls.

### Option 3: Using VS Code Live Server
1. Install the "Live Server" extension in VS Code
2. Right-click on `kingship concierge.html`
3. Select "Open with Live Server"

## Understanding the Errors

### ✅ Fixed with Node.js Server:
- **CORS errors** - Resolved by using `http://` instead of `file://`
- **501 POST errors** - Fixed by handling POST requests properly

### ⚠️ Expected Errors (Normal):
- **404 for missing files** - Some Squarespace assets may not be in the export
- **Google Maps warnings** - Just warnings, not critical errors
- **Chunk loading errors** - Some JavaScript modules may be missing

These are normal when running an exported Squarespace site offline. The site should still display and function for basic viewing.

## Troubleshooting

**"node is not recognized"**
- Install Node.js from https://nodejs.org/
- Restart your terminal after installation

**Port 8000 already in use**
- Edit `server.js` and change `PORT = 8000` to another number (e.g., 8001)
- Update the URL in your browser accordingly


# Code Signing Setup Guide for KOVIX

This guide explains how to set up code signing certificates for all platforms.

## Overview

Kovix uses self-managed code signing (no Microsoft ESRP). You need certificates for each platform you want to ship on.

## Windows — Authenticode Signing

### Option 1: DigiCert / Sectigo (Recommended)
1. Go to [DigiCert](https://www.digicert.com/signing/code-signing-certificates) or [Sectigo](https://sectigo.com/ssl-certificates-tls/code-signing)
2. Purchase an OV Code Signing Certificate (~$200-400/year)
3. For EV signing (immediate SmartScreen trust): ~$400-800/year

### Setup in GitHub Actions
Add these secrets to your repository:
- `WINDOWS_CODESIGN_CERT_BASE64` — Base64-encoded PFX certificate
- `WINDOWS_CODESIGN_PASSWORD` — PFX password

To create the base64:
```bash
base64 -i your-certificate.pfx
```

### How signing works
The `release.yml` workflow automatically:
1. Imports the PFX certificate
2. Signs all .exe files with signtool
3. Uses DigiCert timestamp server

## macOS — Developer ID Signing

### Prerequisites
1. Apple Developer Account ($99/year) — [developer.apple.com](https://developer.apple.com)
2. Developer ID Application Certificate

### Setup
1. Open Xcode → Settings → Accounts → Add Apple ID
2. Click "Manage Certificates" → Add "Developer ID Application"
3. Export the certificate as .p12

### GitHub Actions Secrets
- `MACOS_CODESIGN_IDENTITY` — Certificate identity (e.g., "Developer ID Application: Your Name (TEAMID)")
- `APPLE_ID` — Your Apple ID email
- `APPLE_TEAM_ID` — Your team ID
- `APPLE_APP_SPECIFIC_PASSWORD` — App-specific password from appleid.apple.com

### Notarization
After signing, the workflow automatically:
1. Archives the .app
2. Submits to Apple for notarization
3. Staples the notarization ticket

## Linux — GPG Signing

### Setup
1. Generate a GPG key:
```bash
gpg --full-generate-key
# Choose RSA and RSA, 4096 bits, no expiration
# Use "Razisafir <contact@razisafir.com>"
```

2. Export the key:
```bash
gpg --armor --export YOUR_KEY_ID > gpg-public.key
gpg --armor --export-secret-keys YOUR_KEY_ID > gpg-private.key
```

### GitHub Actions Secrets
- `GPG_PRIVATE_KEY` — ASCII-armored private key
- `GPG_KEY_ID` — Key ID (e.g., "ABCD1234")

### How signing works
The `release.yml` workflow:
1. Imports the GPG key
2. Signs .deb packages with dpkg-sig
3. Creates detached .sig files for tar.gz

## Quick Start (No Certificates)

If you don't have certificates yet, the build will still work — it just won't be signed. Users will see warnings like:
- Windows: "Unknown Publisher" (SmartScreen warning)
- macOS: "App is from an unidentified developer" (Gatekeeper warning)
- Linux: No warning (but no package signature verification)

## Certificate Costs Summary

| Platform | Provider | Cost | Lead Time |
|----------|----------|------|-----------|
| Windows OV | DigiCert/Sectigo | $200-400/yr | 1-7 days |
| Windows EV | DigiCert/Sectigo | $400-800/yr | 3-10 days |
| macOS | Apple Developer | $99/yr | Instant |
| Linux | GPG (free) | $0 | Instant |

**Total minimum: $99/year (Apple) + $0 (GPG) = $99/year**
**Recommended: $99 + $200 = ~$300/year for all platforms**

## Verification

After setup, trigger a release build:
```bash
gh workflow run release.yml -f version=1.0.0-rc.1
```

Check the release artifacts for signing:
- Windows: Right-click .exe → Properties → Digital Signatures
- macOS: `codesign -dv --verbose=4 Kovix.app`
- Linux: `dpkg-sig --verify kovix_1.0.0_amd64.deb`

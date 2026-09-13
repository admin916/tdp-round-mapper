#!/usr/bin/env bash
# Archive the iOS app and upload it to TestFlight using an App Store Connect API key.
#
# Usage:
#   export ASC_KEY_ID=XXXXXXXXXX
#   export ASC_ISSUER_ID=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
#   export ASC_KEY_PATH=/absolute/path/to/AuthKey_XXXXXXXXXX.p8
#   scripts/archive-upload.sh
#
# Requires: Xcode command line tools, an Apple Developer account (Team 8XFBB26LLR),
# and an App Store Connect record for com.v3tr4.tdp (create-app-record.mjs can make one).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
IOSDIR="$REPO/ios/App"
BUILD="$REPO/build"
ARCHIVE="$BUILD/TDP.xcarchive"
EXPORT="$BUILD/export"

: "${ASC_KEY_ID:?set ASC_KEY_ID}"
: "${ASC_ISSUER_ID:?set ASC_ISSUER_ID}"
: "${ASC_KEY_PATH:?set ASC_KEY_PATH (path to AuthKey_*.p8)}"

echo "▸ Refreshing web bundle + iOS sync"
( cd "$REPO" && npm run build:www >/dev/null && npx cap sync ios >/dev/null )

echo "▸ Archiving (Release, automatic signing via ASC key)"
xcodebuild -workspace "$IOSDIR/App.xcworkspace" -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$ASC_KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID" \
  clean archive

echo "▸ Exporting signed .ipa (app-store)"
xcodebuild -exportArchive -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$REPO/ios/exportOptions.plist" \
  -exportPath "$EXPORT" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$ASC_KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"

IPA="$(ls "$EXPORT"/*.ipa | head -1)"

# altool locates the API key by name in a known dir — place it there.
KEYDIR="$HOME/.appstoreconnect/private_keys"
mkdir -p "$KEYDIR"
cp -f "$ASC_KEY_PATH" "$KEYDIR/AuthKey_${ASC_KEY_ID}.p8"

echo "▸ Uploading $IPA to App Store Connect / TestFlight"
xcrun altool --upload-app -f "$IPA" -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"

echo "✓ Uploaded. It will appear in App Store Connect → TestFlight after processing (a few minutes)."

# Android path

The website is the first product. Android users can use the responsive website now. Once it is deployed over HTTPS with its web app manifest and service worker, compatible browsers can offer **Install app** or **Add to Home screen**. A home-screen installation uses the same account and server data as the website. It is not a downloadable APK and does not make video streams or chapters available offline.

## Verify the installable website

1. Deploy the website and API at one HTTPS origin.
2. On an Android device, open it in Chrome and check the browser menu for **Install app** or **Add to Home screen**. Installation prompts vary by browser and site usage.
3. Sign in, save a title, reload, and confirm the saved list persists. Test touch targets, navigation, keyboard behavior, and scrolling on a physical phone.
4. Test the standalone app after installation, including a deep link to a title and returning from an external source. Keep a clear offline state: online community, accounts, and media sources need a connection.

## Later: a signed Android package

For the first Android package, a [Trusted Web Activity](https://developer.android.com/develop/ui/views/layout/webapps/trusted-web-activities) built with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) can open the hosted PWA using the phone's browser. This keeps the website as the primary product. It requires a production HTTPS domain, a stable Android application ID, a signing key, and Digital Asset Links that verify the app and website belong to the same developer.

[Capacitor](https://capacitorjs.com/docs/android) is another option if Yoru later needs native integrations beyond the website. This repository does not yet contain an Android project, signed APK, or Play Store release. A Capacitor package must address:

- A deployed HTTPS API and an explicit app-origin authentication strategy. Browser session cookies cannot be assumed to behave identically in a native WebView.
- A secure external-browser OAuth flow with verified return links for Discord; do not collect Discord credentials inside the app.
- System back navigation, Android keyboard/safe-area behavior, accessibility, loading failures, and resuming interrupted connections.
- Media source behavior inside Android WebView, full screen video, provider permissions, and whether a source should open in the system browser.
- App signing with a privately stored keystore, a stable application ID, version codes, and a separate release workflow.
- Privacy disclosures, account management requirements, and the distribution store's current policies before publication.

After those are implemented, generate a debug package for physical-device testing, then a signed APK for direct download or an AAB for a store. Keep signing material out of Git and CI logs. An APK should only be called ready after installation, login, library persistence, playback/source navigation, and room chat have been tested on an actual Android device.

Reference: [Installable PWAs](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

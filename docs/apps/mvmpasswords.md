# mvmPasswords

The Premium integration in mvmPasswords uses encrypted code data locally, reuses an unlocked session or asks for the mvm2factor password, and can remember its key encrypted under the master key when both passwords match.

## Browser extension exclusions

The mvmPasswords extension can exclude addresses from its field icons in its browser settings. Enter one rule per line: `site.com` covers the domain and its subdomains, `*.site.com` covers subdomains only, and `site.com/page1` covers just that page on that host. A full address such as `http://192.0.2.10:8081/references/` also matches its scheme and port. You may omit `http://` or `https://` to match either protocol while still matching the IP, port and path. A page rule matches the exact path; add a query string to restrict it further. The rules stay in the browser and apply to open tabs after saving. On excluded pages the extension does not observe or scan input fields; the vault remains available for manual use.

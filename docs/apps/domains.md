# Domains

Domains connects your own domain or subdomain to mvmOS through a Cloudflare Tunnel, so the desktop and the public Apps Hub pages open at an address such as `mycompany.com` without router settings or certificates.

## Connecting a domain

Open Domains, type the domain and press Connect. The app asks for your sudo password, then shows its steps as they happen: checking the server, downloading the connector, signing in to Cloudflare, creating the secure connection, adding the domain, starting the connection and checking that the address opens.

The Cloudflare sign-in is the official browser sign-in of the connector. The app shows an Open Cloudflare button and a Copy link button. Open it in any browser, choose your domain and click Authorize; the app continues by itself. The domain must already be added to your Cloudflare account. The sign-in is valid for one Cloudflare domain, so a domain from another Cloudflare domain asks for the sign-in again, and all domains must belong to the same Cloudflare account.

## Choosing what a domain shows

Next to the domain you choose what it opens: the whole installation (desktop and all apps), Apps Hub only, or one public app such as mvmAI. With Apps Hub only or a single app, the domain shows just those public pages and never the desktop or the server sign-in; every other address on it answers “Not Found”. On a single-app domain the header has no switcher to other apps and the other apps are neither listed nor reachable. A person who only knows that domain cannot tell that the same server also has a desktop. You can connect several domains, for example one for the desktop and another for Apps Hub. They all use one tunnel, so the Cloudflare records of your domains point to the same tunnel address. This needs a Core version with public domains; removing the domain or the app also removes this setting.

## What the app puts on the server

Everything lives in `/var/lib/mvmos-domains`: its own copy of the open-source `cloudflared` connector, the sign-in certificates, the tunnel credentials and the list of domains. The connector runs as the `mvmos-domains` system service under its own restricted user. A `cloudflared` you already run is not touched. All domains go through one tunnel, and each domain is a CNAME record in Cloudflare that points to it.

## Managing domains

The main screen shows whether the connection is running, with Restart and Disconnect everything, and one row for each domain with Open, Check and Remove. Check opens the address and shows whether it answers. Remove deletes the domain from the tunnel and, where possible, the DNS record the app created. Add another domain repeats the sign-in only when the domain is in a Cloudflare domain you have not authorized yet.

If mvmOS moves to another port, the app updates the tunnel the next time it is opened.

## Using an existing tunnel

Under Another way you can paste the token of a tunnel you created in the Cloudflare dashboard. The app then only installs and runs the connector. The addresses are managed in Cloudflare, so the app shows the connection state but no domain list. Domains created by the app and a pasted token cannot be mixed; disconnect one before using the other.

## Removing

Disconnect everything, or removing the app, stops and deletes the service, deletes the tunnel and the DNS records the app created, removes the app's folder and the system user.

## Security

A connected domain makes mvmOS reachable from the internet. Turn on two-step login for your users in Settings. Every change in Domains asks for your sudo password, and only administrators can open it. Domains is not affiliated with Cloudflare and is not endorsed by Cloudflare.

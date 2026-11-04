# Tailscale policy for Nebotok

**This page is only for sidecar mode** (`compose.tailscale.yaml`, see `docs/deploy.md`,
"Sidecar mode"). In host mode, the default, the game has no Tailscale device of its own: the Mac
mini's own Tailscale shares it on HTTPS port 8445 (`scripts/serve.sh`), and whoever your policy
lets reach the Mac mini on that port can open it. Tailscale's default policy lets every device of
yours reach every port of the Mac mini.

In sidecar mode the game runs on the Mac mini as its own Tailscale device, called `nebotok` and
tagged `tag:nebotok`. This policy lets family devices open the game and nothing else, and lets the
game device reach nothing at all.

## In plain words

- **Who can reach the game:** any device signed in by a member of your tailnet (your family), and
  only on HTTPS (port 443). No other port on the game device is open to anyone.
- **What the game can reach:** nothing. No rule lets `tag:nebotok` start a connection, and Tailscale
  denies everything that is not allowed. If the game were ever taken over, it could not use
  Tailscale to reach the Mac mini, your laptops, phones or anything else on your tailnet.
- **Who can create game devices:** only tailnet admins can hand out the `tag:nebotok` tag.
- **Tagged devices are not people.** A tagged device belongs to the tailnet, not to you, so the
  rules that let *your* devices reach each other do not cover it.

One thing this policy cannot do: Tailscale only controls traffic over the tailnet. The container's
ordinary internet and home-network access is a separate matter, covered in `docs/security.md`.

## The policy

Open the [Access controls](https://console.tailscale.com/admin/acls/file) page in the Tailscale admin
console. A new tailnet starts with a rule that lets every device reach every other device
(`"src": ["*"], "dst": ["*"]`). **That rule must go**: it would let the game device reach
everything. Replace the whole file with this, or merge it into yours by hand:

```hujson
{
  // Only tailnet admins can give a device the game's tag.
  "tagOwners": {
    "tag:nebotok": ["autogroup:admin"],
  },

  "grants": [
    // Family devices can open the game, over HTTPS only.
    // To limit it to some people, define "groups": { "group:family": ["you@example.com", ...] }
    // and use "group:family" here instead of "autogroup:member".
    {
      "src": ["autogroup:member"],
      "dst": ["tag:nebotok"],
      "ip":  ["tcp:443"],
    },

    // Your own family devices can keep reaching each other as before. Tagged devices such as
    // the game are not members, so this does not let the game reach anything. Remove it if you
    // do not need your devices to talk to each other over Tailscale.
    {
      "src": ["autogroup:member"],
      "dst": ["autogroup:member"],
      "ip":  ["*"],
    },

    // There is deliberately no grant with "tag:nebotok" in "src". Never add one.
  ],

  // Tailscale SSH: only into your own devices, and it asks you to sign in again. Never into the game.
  "ssh": [
    {
      "action": "check",
      "src":    ["autogroup:member"],
      "dst":    ["autogroup:self"],
      "users":  ["autogroup:nonroot", "root"],
    },
  ],

  // Checked every time the policy is saved: Tailscale refuses a change that breaks these.
  // Replace you@example.com with the email you sign in to Tailscale with (or delete this section).
  "tests": [
    {
      "src":    "you@example.com",
      "accept": ["tag:nebotok:443"],
      "deny":   ["tag:nebotok:22", "tag:nebotok:2567", "tag:nebotok:9002"],
    },
    {
      "src":  "tag:nebotok",
      "deny": ["you@example.com:22", "you@example.com:443", "you@example.com:445", "you@example.com:5900"],
    },
  ],
}
```

Save. If Tailscale reports a failing test, read it before changing anything: it means some rule
would let the game device reach your devices.

Do not turn on Funnel for this device. Funnel would put the game on the public internet; the
serve config (`deploy/tailscale/serve.json`) also sets it off.

## Also in the admin console

On the [DNS](https://console.tailscale.com/admin/dns) page:

1. **MagicDNS**: on. Devices get names like `nebotok.<your-tailnet>.ts.net`.
2. **HTTPS Certificates**: enable. Tailscale then gets a real certificate for the game's name, so
   the iPad shows a padlock and the game can install as an app.

The certificate is published in the public Certificate Transparency logs, so the device name and
your tailnet's name become public, but nothing can reach the device from outside the tailnet.

## The auth key

The game device logs in once with an auth key. On the
[Keys](https://console.tailscale.com/admin/settings/keys) page, choose **Generate auth key**:

| Setting      | Value                | Why                                                                    |
| ------------ | -------------------- | ---------------------------------------------------------------------- |
| Description  | `nebotok mac mini`   | So you recognise it later.                                             |
| Reusable     | off                  | It is used once. A leaked one-off key that has been used is worthless. |
| Expiration   | 1 to 7 days          | Only needed until the first start.                                     |
| Ephemeral    | off                  | The device must stay on the tailnet across restarts.                   |
| Pre-approved | on                   | So it needs no manual approval if device approval is on.               |
| Tags         | `tag:nebotok`        | The device is the tailnet's, not yours, and the policy above applies.  |

Copy the key (`tskey-auth-...`) straight into `.env` as `TS_AUTHKEY` (the setup wizard does this
without showing it on screen). Tailscale shows a key only once.

After the first start, the `nebotok` device appears on the
[Machines](https://console.tailscale.com/admin/machines) page with the `tag:nebotok` tag. Tagged
devices do not need their key renewed. The container keeps its identity in the `tailscale-state`
volume, so the auth key is not used again; when it expires, nothing changes.

To remove the game from the tailnet, delete the device on the Machines page.

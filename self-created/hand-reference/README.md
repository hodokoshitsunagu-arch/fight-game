# hand-reference — a five-minute intake for hand photographs

`src/world/HandPoses.js` is a set of numbers: joint angles, finger curls, wrist
twists. Numbers invented at a desk are wrong in ways that are invisible until
they are on screen — six sign errors on a single axis got through code review
here, and one of them was asserted the wrong way round by its own test.

The fix is to look at real hands. This is the thing that gets them onto the
machine: run it, hand someone the URL, they photograph their own hands from
their own phone, and the files land in `photos/`.

## Running it

```bash
# 1. a secret, so a public tunnel URL is not an open write endpoint
export DROP_TOKEN=$(openssl rand -hex 8)
node self-created/hand-reference/server.mjs &

# 2. a way in from a phone that is not on this network
cloudflared tunnel --url http://127.0.0.1:8788
```

The tunnel prints a `https://….trycloudflare.com` host. The address to send is
that host **plus the token**:

```
https://<host>.trycloudflare.com/<DROP_TOKEN>/
```

`DROP_PORT` moves it off 8788.

## Why it is shaped like this

The server binds `127.0.0.1` and nothing else. `cloudflared` is the only route
in, so there is no moment where the process is listening on a public interface —
kill the tunnel and the endpoint is gone, no firewall rule to remember.

Everything hangs off the token path. A request without it gets a flat `404`, so
a scanner that finds the tunnel host sees an empty server rather than a locked
door worth working on.

Uploads are raw bodies with the filename in `X-Filename`, not multipart. There
is no multipart parser in this project's dependency tree, and hand-rolling one
for a five-minute endpoint is precisely the code that ends up with a path
traversal in it. `safeName()` reduces whatever arrives to a basename and strips
it to `[\w.\- ]`, so a name cannot address anything outside `photos/`.

The caps — 16 MB a file, 400 MB and 120 files in total — exist so that leaving
the tunnel up overnight cannot fill the disk.

## What happens to the photographs

They stay in `photos/`, which is gitignored. They are somebody's hands; what
belongs in the repository is the pose numbers measured from them, not the
source images. Delete them when the poses are rebuilt.

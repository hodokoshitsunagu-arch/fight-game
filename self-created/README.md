# self-created — the scene we made ourselves

Everything here produces the Shibuya Crossing backdrop, as opposed to the
Street View backdrop, which is Google's imagery served live by Google's own
viewer and never stored by us. Keeping the two apart is the point of this
folder: one of them we own outright, the other we are only allowed to display.

## Where things live

| | |
| --- | --- |
| `self-created/` | the generators — source and tooling |
| `public/self-created/` | what they produce — the panoramas the app loads |

Split because Vite serves static files from `public/` and nowhere else, so
anything the browser fetches has to sit under it. Treat `public/self-created/`
as build output that happens to be committed: it is checked in because
regenerating costs an API call, not because it is hand-maintained.

`public/hdri/spruit_sunrise.hdr` is **not** ours — it is a CC0 probe from Poly
Haven, and it lights the scene rather than backing it. It stays where it is.

## What is in there

| file | what it is |
| --- | --- |
| `shibuya_rain_high.jpg` + `_depth.png` | the default backdrop. Generated, captured ~25m above the crossing, which is roughly where this camera already sits |
| `shibuya_rain.jpg` + `_depth.png` | the first attempt, from street level. Kept as the comparison that showed why the viewpoint has to match the camera |
| `shibuya_crossing.png` + `_depth.png` | procedural, not generated. Its depth map is computed rather than traced, so silhouettes are exact |
| `test_panorama_4k.png` | a calibration card — hard horizon, longitude ticks every 30°, a sun. For checking a new panorama's level and rotation against known geometry |

Every pair is 4096×2048 and strictly 2:1, and every depth map is 8-bit
disparity — `near / distance`, so the bits land where parallax is visible
rather than on the skyline. `settings.environment.depthNear` and `depthFar`
have to agree with whatever produced it.

## Making another one

```bash
# 1. generate. Needs IMAGE_GEN_* in .env
node self-created/generate-panorama.mjs raw.jpg "your prompt"

# 2. fix what an image model cannot do, and derive depth.
#    args: <raw> <output base> [eye height, metres] [distance to facades]
node self-created/process-panorama.mjs raw.jpg public/self-created/name 25 60

# 3. look at it
#    http://localhost:5173/?panorama=./self-created/name.jpg
```

Step 2 is not optional. An image model gives you none of this:

- **2:1.** The API refuses that aspect ratio; the closest it offers is 16:9, so
  the result is resampled.
- **A wrap.** The left and right edges are the same place in an equirectangular
  image, and they never come back matching — measured at 15–24 against 3–5 for
  two ordinary adjacent columns, which in-engine is a hard vertical line you
  rotate straight into. Corrected by spreading the edge error backwards across
  3% of the width, and the script prints the mismatch before and after so a new
  panorama can be judged rather than assumed.
- **Depth.** Below the horizon the projection fixes ground distance exactly from
  the elevation angle; above it the skyline is traced by walking each column
  down to the first lit row, which works because at night the sky is the darkest
  thing up there.

**The eye height argument matters.** It sets every ground distance in the depth
map, so it has to match what the prompt asked for — a 25-metre capture is not a
2-metre one, and getting it wrong puts the whole street at the wrong distance.

## Loading one

```
?panorama=./self-created/shibuya_rain_high.jpg
```

The depth map is found from the panorama's own name (`_depth.png` first, since a
depth map nearly always is one — JPEG's block compression shows up in geometry
as wobble along every silhouette). Finding it switches the backdrop on, turns on
parallax, and re-stages the scene: the floor is trimmed to a plaza, fog is
pulled in to finish before the floor's edge, the camera comes up to nearly
level, and the floor takes its colour from the panorama's own road. All of it
stays adjustable under **Environment → Backdrop** in the editor.

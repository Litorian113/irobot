# VIKI head source assets

`public/models/VikiHead.glb` is built locally by `scripts/build_head.py`. The build uses the source geometry and
shape targets below; it does not download assets or execute MakeHuman application code.

| Source | Revision / credit | License |
| --- | --- | --- |
| [MakeHuman base mesh, female macro targets and high-poly eye proxy](https://github.com/makehumancommunity/makehuman/tree/a8bc2d54ff0ac92e78ff71431b1023eda42bf482/makehuman/data) | MakeHuman team, revision `a8bc2d54ff0ac92e78ff71431b1023eda42bf482` | CC0; upstream `LICENSE.ASSETS.md`, copied as `LICENSE-CC0.md` |
| [Face units 01](https://static.makehumancommunity.org/assets/assetpacks/faceunits01.html) | Mika Suominen; [source archive](https://files2.makehumancommunity.org/functional/faceunits01.zip) | CC0 per target, recorded in `faceunits/packs/faceunits01.json` |

The bundled `makehuman-head.zip` contains the required base/proxy assets, macro targets, face-unit pack metadata,
target files and `revision.txt`. Upstream's [asset licensing explanation](https://static.makehumancommunity.org/makehuman/faq/are_makehuman_files_free.html)
distinguishes the CC0 core assets from the application code.

Source archive SHA-256:
`cb7ae79ac3d799bee1598f150ca581935f91731f96f8441a1d3921a0656149f9`

Current generated GLB SHA-256:
`4772943e96d5926045ef7a0a9b49de41b056f59521fcf07b3d487c75f446d5c0`

## Rebuild

With Blender 4.1.1 (the version used for the checked asset):

```sh
blender --background --factory-startup --python scripts/build_head.py
```

The script applies the female-young macro shape, retains the skin through the upper neck, fits actual eyeballs,
adds a recessed mouth interior and bakes one Catmull-Clark subdivision for each pose. It exports relative morphs
and their normals, plus `VikiHead.json` with normalization landmarks and source information.
The archive is extracted to a temporary directory and removed after the build. No network is needed.

The model is normalized using eye joints and lip vertices, rather than the previous scan's transform. All three
parts are retained at runtime. The sixteen morphs are `jawOpen`, `mouthWide`, `mouthRound`, `smile`, `frown`,
`blinkLeft`, `blinkRight`, `browUp`, `browDown`, `mouthClose`, `mouthPress`, `mouthPucker`, `mouthFunnel`,
`upperLipUp`, `lowerLipDown`, and `lowerLipRoll`. The last seven come from additional targets already in the
bundled face-unit pack. The neutral geometry, normals and original nine poses are unchanged by this extension.
Part labels `Skin`, `Eyes`, and `MouthInterior` keep shading on the appropriate geometry.

The old Lee Perry-Smith model has its own CC BY 3.0 terms; this CC0 description applies only to the new VikiHead asset.

# O.T.L. head source assets

`public/models/AicherHead.bin` (with `AicherHead.json`) is Otl Aicher's faceted head, built locally by
`scripts/build_aicher.py` from the same base mesh, eye proxy and face units as above, plus
`makehuman-aicher.zip`: 50 shape targets from the same MakeHuman revision
(`a8bc2d54ff0ac92e78ff71431b1023eda42bf482`, CC0, each file carries its CC0 header) - the old male macro
targets and detail targets for head, forehead, nose, brows, eyes, ears, chin, cheeks, mouth, neck and torso.

Source archive SHA-256:
`6d1beed597aa26cd1f121915b28f0ec355b954e41ecc6599d5020159cd107e60`

Current generated binary SHA-256:
`def3665e4611576a5b050645c534243b647cabb2ff58c9307a57de0359cfff73`

## Rebuild

```sh
blender --background --factory-startup --python scripts/build_aicher.py
```

The script applies the likeness targets, cuts the head at the neck, offsets the short-cropped hair a little from the scalp, and decimates to about 2600 facets; a stand-up collar
and shoulders that slope out of the frame are then built straight onto the low-poly neck edge. Four relative
morphs (`smile` with squinting eyes, `blink`, `browUp`, `browDown`) are carried over to the low-poly mesh by
projecting each vertex onto the full-resolution surface. Each facet stores a region (skin, hair, brow, eye, shirt)
that the runtime shader colours; facet normals are computed at runtime, so the asset holds no normals.

## Avicii head (`public/models/AviciiHead.*`)

Built by `scripts/build_avicii.py` (Blender 4.1.1, no network) from the MakeHuman base mesh and face units above, plus
`makehuman-avicii.zip`: thirty-five young-male and face shape targets from `makehuman/data/targets` at the same pinned revision
`a8bc2d54ff0ac92e78ff71431b1023eda42bf482` (CC0, see `LICENSE-CC0.md`), with `revision.txt`. The cap and its brim
are built by the script itself.

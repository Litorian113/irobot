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
`0ab63f1ef21f82320b6c03ef2a1c46f9c6ce8cb3ba1cf268ab85a3f07e8df757`

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
parts are retained at runtime. The nine morphs are `jawOpen`, `mouthWide`, `mouthRound`, `smile`, `frown`,
`blinkLeft`, `blinkRight`, `browUp`, and `browDown`. Part labels `Skin`, `Eyes`, and `MouthInterior` keep shading
on the appropriate geometry.

The old Lee Perry-Smith model has its own CC BY 3.0 terms; this CC0 description applies only to the new VikiHead asset.

# HeadAudio runtime assets

Source: [met4citizen/HeadAudio](https://github.com/met4citizen/HeadAudio/tree/d3af5f9ff86ab6b2b1913d411a4e1922ec101953),
pinned revision `d3af5f9ff86ab6b2b1913d411a4e1922ec101953`.
Copyright (c) 2025 Mika Suominen; distributed under the accompanying [MIT license](LICENSE).

These files are copied unchanged from upstream `dist/`:

| File | SHA-256 |
| --- | --- |
| `headworklet.min.mjs` | `37ebeb1d4d7e41fca7d12bb8fb411f7ce6bb21a2589602dec18e0a48b343be55` |
| `model-en-mixed.bin` | `0358f68989b5861f9b7d18871b010fa6cbf88a53bda4954a954d8c548bbcf251` |

`public/audio/viseme-worklet.mjs` wraps the processor with AudioContext timestamps, initialization acknowledgement
and generation tags to discard events from interrupted speech. It does not change the classifier.
`src/viki/visemeModel.ts` reads the upstream binary prototype format. The detector runs locally on the assistant's
remote audio track; no detector CDN, secondary API, audio upload or HeadAudio wrapper dependency is used.

The bundled model classifies MFCC features into 15 Oculus visemes, including silence. It is trained on English
speech; other languages and voices need listening/visual evaluation. This provides approximate audio-driven
articulation, not guaranteed phoneme or word alignment. See upstream's
[timing guidance](https://github.com/met4citizen/HeadAudio#using-the-headaudio-worklet-nodeprocessor).

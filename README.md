# AfterSound

> You can't hear the damage happening. Now you can.

AfterSound measures the noise around you, projects your hearing forward using
NIOSH criteria, and replays five seconds of your own audio through your
projected future ears — so the damage is audible before it's irreversible.

## Status

 scaffold — not yet functional. See `HACKATHON_BRIEF.md` for the full spec.

## Tech

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS v4
- audiomotion-analyzer (real-time spectrum visualization)
- GSAP (animation)
- Web Audio API (AudioWorklet, AnalyserNode, biquad filters)

## License

GNU AGPL-3.0-or-later. See [LICENSE](./LICENSE).

## Acknowledgements

- [audiomotion-analyzer](https://github.com/hvianna/audiomotion-analyzer) by
  hvianna — AGPL-3.0
- NIOSH criteria document DHHS 98-126 — public domain

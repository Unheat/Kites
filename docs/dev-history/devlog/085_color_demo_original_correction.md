# Color demo original correction

**Date:** 2026-10-28

## Problem

The README, v1.3.0 release notes, and website paired an unrelated Japanese page (`README_images/input/demo6`) with the correct Chinese-to-English colorized result. The website thumbnail repeated the unrelated input. Release notes also used relative image URLs, which are not reliable repository asset references from a release page.

## Correction

Visually checked the test images and confirmed `src/test/test-img/image6.jpg` is the Chinese grayscale original of the displayed result. The similarly named `scratches/0001_image6.png` is an English translated export, not the original input.

- Copy the original JPEG without modification into `README_images/input/color-bubble-original.jpg` and `site/assets/color-bubble-original.jpg`.
- Generate a small, correctly encoded JPEG thumbnail from that original.
- Point the README and website comparison at the new original, with captions and alternative text describing full translation plus colorization.
- Preserve the existing result images byte-for-byte. The input and output have different export dimensions; no attempt is made to alter the original or manufacture pixel alignment.
- Update the published v1.3.0 release comparison with explicit original/result labels and absolute, commit-pinned raw GitHub image URLs. The extension ZIP and release tag do not need replacement for this documentation-only correction.
- Preserve the old `demo6` asset rather than replacing an unrelated, reusable input image in place.

## Validation

- Visually verified the Chinese original against the existing colored English result.
- Confirmed both copied originals are byte-identical to the test fixture.
- Confirmed both result image SHA-256 hashes remain `7db5d3f11294513390ed018866a9b9ba857f97c81f2342e8d15a57b83d0c2af0`.
- Checked all 15 website image/icon references and JavaScript demo image paths resolve to existing files.
- `node --check site/js/main.js` and `git diff --check` pass.
- Repository lint passes with existing warnings; no extension runtime code changed.
- Browser comparison selection displays the Chinese original and English colorized result, with the corrected caption and active thumbnail.
- Uploaded an isolated Cloudflare Pages preview and fetched the deployed original to verify exact source bytes before production publication.

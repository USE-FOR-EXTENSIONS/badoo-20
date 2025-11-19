Download images with provided selectors
=====================================

This file explains how to use the `download-images-snippet.js` console snippet included in the repo.

Steps
-----
1. Open the target Badoo page where the first selector (user list) applies.
2. Open Developer Tools (F12) → Console.
3. Open the file `download-images-snippet.js` from the repository, copy all its contents and paste it into the Console.
4. Press Enter to load the snippet; it will expose a global `runAll()` function.
5. Call `runAll()` to begin processing items found by the FIRST selector. The script will:
   - click each matched list item (FIRST selector), open the profile,
   - scroll the profile content area using the configured SCROLLBAR selector to load images,
   - fall back to clicking the gallery-open button (SECOND selector) if the scrollbar is not present,
   - extract image URLs from the scroller or the fullscreen gallery (or the THIRD selector area) and trigger browser downloads.

Notes & Caveats
---------------
- The snippet simulates clicks and sends `Escape` to close modals, using small waits between actions — adjust delays if the site is slower.
- If your browser blocks multiple automatic downloads, enable "Allow multiple downloads" or accept prompts as they appear.
- If selectors no longer match due to site changes, edit the selectors inside the snippet to the correct values.
- Use this script responsibly and in accordance with the site's terms of service.

Support
-------
If the snippet misses images or the UI flows differently, please open an issue describing the exact page flow and any observed DOM differences.

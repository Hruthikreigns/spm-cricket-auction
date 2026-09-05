Sounds played by the auction screens.

  firework.mp3   plays as the fire flowers bloom, when a player sells
  unsold.mp3     optional - played when a player goes unsold
  bid.mp3        optional - a short tick as each bid lands

There is no built-in substitute. A file that isn't here is simply silent, so
unsold.mp3 and bid.mp3 do nothing until you add them.

Replacing them
--------------
Keep the names exactly as above, all lowercase. .mp3, .wav, .ogg and .m4a all
work - for a different extension, edit the FILES map at the top of
src/lib/sound.ts. Hard refresh the browser afterwards (Ctrl+Shift+R).

Keep each clip to about three seconds. The auctioneer is already calling the
next player by then.

Credits for what ships here
---------------------------
firework.mp3 is the opening three seconds of "New Year's Eve in Peru -
fireworks, fire crackers and rockets", Pisco, Peru 2012, from the Freesound
community via Pixabay. Faded at both ends and levelled to about -0.7 dBFS.

Check the original licence before using it on a public site, and keep this
note if the licence asks for attribution.

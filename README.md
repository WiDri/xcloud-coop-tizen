# xCloud Co-op voor Samsung Tizen

Een minimale variant van Better xCloud die maar één ding doet: elke controller met zijn
eigen nummer naar de xCloud-server sturen, zodat lokale co-op werkt (bijv. twee spelers in EA FC).
De patch is overgenomen van Better xCloud (MIT, © redphx, zie LICENSE-better-xcloud).

## Wat het script doet (`dist/xcloud-coop.js`, ±190 regels)

1. Onderschept de webpack-chunks van xbox.com/play voordat ze draaien.
2. Zoekt de inputmanager (herkenbaar aan `this.gamepadMappingsToSend=[],`) en maakt
   gepatchte versies van `onGamepadChanged` / `onGamepadInput` die het echte
   controllernummer doorgeven in plaats van altijd 0.
3. Zet in de streamconfiguratie `useUnreliableInput` uit, zoals Better xCloud bij co-op doet.
4. Activeert de patch zodra de video speelt en toont een melding in beeld met het aantal controllers.

## Eerst testen op de pc (aanrader)

Installeer Tampermonkey in Chrome/Edge, maak een nieuw script aan en plak `dist/xcloud-coop.js` erin.
Sluit twee controllers aan, start FC via xbox.com/play en kijk of het kant-kiesmenu twee icoontjes toont.
Werkt het daar, dan is de patch goed en ligt een eventueel probleem op de tv aan de tv zelf.
(Zet Better xCloud dan wel even uit, anders patchen ze allebei.)

## Op de tv (TizenBrew)

1. Installeer TizenBrew met de TizenBrew Installer.
2. Push deze map naar een **publieke** GitHub-repo, bijv. `wietse/xcloud-coop-tizen` (geen tags aanmaken).
3. TizenBrew → Module Manager → **Add GitHub Module** → `wietse/xcloud-coop-tizen`.
4. Koppel beide controllers via Bluetooth aan de tv en start de module.

## Meldingen in beeld

- *Controller 2 verbonden (2 totaal)*: de tv geeft beide controllers door. Goed.
- *Lokale co-op aan · 2 controller(s)*: patch actief bij het starten van de stream.
- *Co-op-patch niet actief*: Microsoft heeft de xCloud-code veranderd; kijk in de nieuwste
  Better xCloud-release (functie `supportLocalCoOp`) wat de nieuwe zoektekst is.
- Je ziet maar 1 controller: de tv geeft de tweede niet als aparte gamepad door, daar helpt geen script.

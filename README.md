<!--
author:   MINT-the-GAP, Martin Lommatzsch
version:  0.0.1
language: de
edit:     true
comment:  LiaScript plugin for reusable math path components.
script:   ./dist/index.js


import: https://raw.githubusercontent.com/MINT-the-GAP/Aufgabensammlung/main/imports/FreezeREADME.md

@Explain: __LIAEXPLAIN__

-->

# LiaScript MathPath Plugin



Dieses Repository bildet die technische Basis für den schrittweisen Aufbau von `lia-mathpath`.



``` markdown
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/refs/heads/master/README.md
```


Der Fokus der ersten Ausbaustufe liegt auf einer stabilen Repo-Struktur (TypeScript Quellcode,
Parcel Build nach `dist/index.js`, importierbare LiaScript README).


__Try it on LiaScript:__
https://liascript.github.io/course/?https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/master/README.md



In einem LiaScript Kurs kann das Plugin so eingebunden werden:

`import: https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/master/README.md`


# Makro `@Explain`

Das Makro `@Explain` erzeugt kontextbezogene Erklärungs-Hinweise für Quizfragen.
Die Themen werden aus `@ADetails(...)` gelesen und mit den Links aus `Explain.md`
verknüpft.

**Zweck**

- Zeigt Erklärungs-Links passend zur aktuellen Aufgabe
- Erscheint nur im Hint-Kontext (nicht vorab im Aufgabentext)
- Öffnet Erklärungen im Overlay (90% Fensterbreite und 90% Fensterhöhe)

**Voraussetzungen**

1. `@Explain` muss im Hint-Bereich der Aufgabe stehen.
2. `@ADetails` muss für die Aufgabe vorhanden sein.
3. Themen in `@ADetails` werden mit Komma getrennt.

**Syntax**

```markdown
<!-- data-hint-button="1" -->
Bruchrechnung: [[  Test  ]]
[[?]] @Explain

@ADetails(1=BE; Bruchrechnung, Einheiten)
```

<!-- data-hint-button="1" -->
Bruchrechnung: [[  Test  ]]
[[?]] @Explain

@ADetails(1=BE; Bruchrechnung, Einheiten)


**Verhalten zur Laufzeit**

1. Vor dem ersten Prüfen ist kein nativer Hint-Button sichtbar (bei `data-hint-button="1"`).
2. Nach dem ersten Prüfen erscheint der native Hint-Button.
3. Nach Klick auf den Hint-Button werden die Explain-Hinweise eingeblendet.
4. Klick auf einen Explain-Link öffnet die Zielseite im Overlay statt in einem neuen Tab.


# Bereich ohne Tooltips (`notip`)

Mit einem Container `<div class="notip"> ... </div>` kannst du einen Bereich markieren,
in dem **keine Glossar-Highlights und keine Tooltips** angezeigt werden.

Das ist nützlich für sensible Lösungsbereiche, Antwortfelder oder Texte, die bewusst
ohne Hilfen dargestellt werden sollen.

**Beispiel**

```markdown
Außerhalb des notip-Bereichs kann das Wort Bruchrechnung markiert werden.

<div class="notip">
Im notip-Bereich bleiben Begriffe wie Bruchrechnung oder Gleichung ohne Tooltip.
</div>
```


Außerhalb des notip-Bereichs kann das Wort Bruchrechnung markiert werden.

<div class="notip">
Im notip-Bereich bleiben Begriffe wie Bruchrechnung oder Gleichung ohne Tooltip.
</div>



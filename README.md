<!--
author:   MINT-the-GAP; Martin Lommatzsch
version:  0.0.3
language: de
edit:     true
comment:  LiaScript plugin for reusable math path components.
script:   ./dist/index.js?v=0.0.3


@Explain: <lia-mathpath-explain></lia-mathpath-explain>

-->

# LiaScript MathPath Plugin



Dieses Repository bildet die technische Basis für den schrittweisen Aufbau von `lia-mathpath`.



``` markdown
import: https://raw.githubusercontent.com/MINT-the-GAP/Aufgabensammlung/main/imports/FreezeREADME.md
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/refs/heads/master/README.md
```


Der Fokus der ersten Ausbaustufe liegt auf einer stabilen Repo-Struktur (TypeScript Quellcode,
Parcel Build nach `dist/index.js`, importierbare LiaScript README).


__Try it on LiaScript:__
https://liascript.github.io/course/?https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/master/README.md



In einem LiaScript-Kurs werden `FreezeREADME.md` und MathPath direkt im einzigen
LiaScript-Hauptkopf und in dieser Reihenfolge eingebunden. Auf verschachtelte
Template-Imports sollte man sich nicht verlassen:

```markdown
import: https://raw.githubusercontent.com/MINT-the-GAP/Aufgabensammlung/main/imports/FreezeREADME.md
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/refs/heads/master/README.md
```

Erst danach steht das MathPath-Makro `@Explain` im Kurs zur Verfügung.


# Glossarbegriffe sicher verwenden

MathPath ersetzt keine von LiaScript beziehungsweise Elm verwalteten Textknoten. Normale
Glossarbegriffe werden dort als DOM-Ranges erkannt und ohne zusätzliche Wrapper über CSS
Highlights beziehungsweise einen externen Overlay-Fallback markiert. Hover und Klick werden
anhand der Range-Rechtecke erkannt. Vorhandene semantische Elemente bleiben Begriffsträger.

## Kursive Volltreffer

Ein kursiv geschriebener Begriff wie `*Bruch*` wird von Markdown als bestehendes
`<em>`-Element erzeugt. MathPath bindet den Tooltip an dieses Element, wenn dessen gesamter
Text nach dem Trimmen genau einem Glossarbegriff oder einer Aliasform entspricht. Der enthaltene
Textknoten wird dabei nicht ersetzt. Setze Satzzeichen außerhalb der Kursivmarkierung; ein Ausdruck
wie `*ein Bruch*` ist kein Volltreffer.

## Aliasformen in `Glossar.md`

Die optionale dritte Tabellenspalte `Aliasformen` enthält mit Semikolon getrennte, ausdrücklich
erlaubte Wortformen. Alte Glossare mit nur `Begriff` und `Erklärung` bleiben gültig.

```markdown
| Begriff | Erklärung | Aliasformen |
|---|---|---|
| Bruch | Ein Bruch besteht aus einem Zähler und einem Nenner. | Brüche; Brüchen |
| Erweitern | Brüche können durch Erweitern umgeformt werden. | erweitert |
```

Begriff und Aliasformen werden als vollständige Wörter abgeglichen. Kleingeschriebene
Verb- und Adjektivformen ignorieren dabei die Groß-/Kleinschreibung, damit sie auch am Satzanfang
funktionieren. Eine großgeschriebene Aliasform kennzeichnet dagegen eine substantivische Form und
wird im automatisch gescannten Text nur mit großem Anfang markiert. So verweist `Zahlen` auf
`Zahl`, während das Verb in `wir zahlen` unmarkiert bleibt. Es findet kein allgemeines Stemming
statt. Ein exakter Glossarbegriff hat Vorrang vor einer Aliasform; bei überlappenden Treffern wird
die längere, genauere Form verwendet.


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

<span class='lia-assignment-details' data-adetails='1=BE; Bruchrechnung' data-adetails-all='1=BE; Bruchrechnung, Einheiten' style='display:none !important;'></span>


**Verhalten zur Laufzeit**

1. Vor dem ersten Prüfen ist kein nativer Hint-Button sichtbar (bei `data-hint-button="1"`).
2. Nach dem ersten Prüfen erscheint der native Hint-Button.
3. Nach Klick auf den Hint-Button werden die Explain-Hinweise eingeblendet.
4. Klick auf einen Explain-Link öffnet die Zielseite im Overlay statt in einem neuen Tab.
5. Ist für keines der ermittelten Themen ein Erklärungskurs verlinkt, erscheint stattdessen
   der Hinweis „Leider gibt es noch keinen automatisch verlinkten Erklärungskurs.“
6. Die Links und der Hinweis werden im Shadow DOM von `lia-mathpath-explain` gerendert; die native
   Hint-Struktur bleibt vollständig unter LiaScripts Kontrolle.


# Bereich ohne Tooltips (`notip`)

Mit einem Container `<div class="notip"> ... </div>` kannst du einen Bereich markieren,
in dem **keine Glossar-Highlights und keine Tooltips** angezeigt werden.

Das ist nützlich für sensible Lösungsbereiche, Antwortfelder oder Texte, die bewusst
ohne Hilfen dargestellt werden sollen. Das gilt auch für kursive Volltreffer und
manuelle `[data-lia-term]`-Elemente.

## Sichtbares Testbeispiel

Ein *Bruch* besitzt einen *Zähler* und einen *Nenner*. Mehrere *Brüche* verwenden dieselbe
Glossarerklärung für den Begriff Bruch.

Die Division ist hier absichtlich normal und nicht kursiv geschrieben.

<div class="notip">
Hier bleibt <em>Bruch</em> ohne Hervorhebung und Tooltip.
</div>

**Quelltext des `notip`-Bereichs**

```markdown
<div class="notip">
Hier bleibt <em>Bruch</em> ohne Hervorhebung und Tooltip.
</div>
```

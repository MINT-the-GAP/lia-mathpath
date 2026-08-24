<!--
author:   MINT-the-GAP; Martin Lommatzsch
version:  0.0.8
language: de
edit:     true
comment:  LiaScript plugin for reusable math path components.
script:   ./dist/index.js


@Explain: <lia-mathpath-explain data-lia-explain-topic="@0"></lia-mathpath-explain>

@tooltip: <script modify="false">void window.__LIA_MATHPATH__.setTooltips("@'0")</script>

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


**Live-Test: manuell und außerhalb eines Hints**

@Explain(Tutorial)



Für ein manuell gesetztes Explain-Thema muss MathPath direkt im einzigen
LiaScript-Hauptkopf des verwendenden Kurses importiert werden:

```markdown
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/refs/heads/master/README.md
```

Soll `@Explain` das Thema automatisch aus `@ADetails` ermitteln, werden
`FreezeREADME.md` und MathPath direkt und in dieser Reihenfolge eingebunden.
Auf verschachtelte Template-Imports sollte man sich nicht verlassen.

```markdown
import: https://raw.githubusercontent.com/MINT-the-GAP/Aufgabensammlung/main/imports/FreezeREADME.md
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/refs/heads/master/README.md
```

Nach dem MathPath-Import stehen die Makros `@Explain` und `@tooltip` im Kurs zur Verfügung.
Ein Import eines anderen Templates, das seinerseits MathPath einbindet, reicht
nicht zuverlässig aus. Bleibt `@Explain(...)` als Text sichtbar, fehlt im
verwendenden Kurs fast immer dieser direkte Import.


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

Das Makro `@Explain` erzeugt Links zu passenden Erklärungskursen. Ein manuell
gesetztes Thema wie `@Explain(Tutorial)` kann an beliebiger Stelle im Kurs stehen.
Beim parameterlosen Aufruf wird das Thema wie bisher aus `@ADetails(...)` gelesen.
Die Themen werden mit den Links aus `Explain.md` verknüpft.

**Zweck**

- Zeigt Erklärungs-Links passend zur aktuellen Aufgabe
- Kann mit einem manuell gesetzten Thema frei im Kurs platziert werden
- Kann parameterlos als kontextbezogener Hinweis einer Aufgabe verwendet werden
- Öffnet Erklärungen im Overlay (90% Fensterbreite und 90% Fensterhöhe)

**Voraussetzungen**

1. Das manuelle Thema muss der Schreibweise in der ersten Spalte von `Explain.md`
   entsprechen; Groß-/Kleinschreibung und Akzente werden beim Abgleich normalisiert.
2. `@Explain(Thema)` benötigt weder ein Quiz noch einen Hint oder `@ADetails`.
3. Nur für den automatischen Aufruf `@Explain` muss `@ADetails` vorhanden sein.
   Mehrere Themen in `@ADetails` werden mit Komma getrennt.

**Manuell ohne Freeze und außerhalb eines Hints**

```markdown
Dieser Erklärungskurs kann frei im Kurs verlinkt werden:

@Explain(Tutorial)
```

Der zugehörige Live-Test steht auf der Startfolie dieses Kurses.


**Automatisch mit `@ADetails`**

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
5. Ein explizites Thema aus `@Explain(Thema)` hat Vorrang vor einem vorhandenen
   `@ADetails`-Kontext.
6. Ist für keines der ermittelten Themen ein Erklärungskurs verlinkt, erscheint stattdessen
   der Hinweis „Leider gibt es noch keinen automatisch verlinkten Erklärungskurs.“
7. Die Links und der Hinweis werden im Shadow DOM von `lia-mathpath-explain` gerendert; die native
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


# Automatische Tooltips ausschalten

Mit `@tooltip(off)` werden alle automatisch erkannten Glossarbegriffe ab dieser
Kursposition weder hervorgehoben noch als Tooltip geöffnet. Bereits erkannte
Begriffe werden sofort deaktiviert, und später gerenderte Inhalte bleiben ebenfalls
ohne automatische Tooltips. Manuell gesetzte Elemente mit `data-lia-term` sowie
`@Explain` funktionieren weiterhin.

```markdown
@tooltip(off)
```

Das Makro wird beim Rendern einer Folie erneut ausgewertet. Der Zustand bleibt
erhalten, bis `@tooltip(on)` ausgeführt wird.

@tooltip(off)

In diesem Live-Beispiel bleibt der automatisch erkannte
<em data-tooltip-probe="automatic">Bruch</em> ohne Tooltip. Der
<span data-tooltip-probe="manual" data-lia-term="Bruch">manuell gesetzte Begriff</span>
bleibt dagegen aktiv.


# Automatische Tooltips wieder einschalten

```markdown
@tooltip(on)
```

@tooltip(on)

Hier ist der automatisch erkannte
<em data-tooltip-probe="automatic">Bruch</em> wieder aktiv.
